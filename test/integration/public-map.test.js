'use strict';

// Shared maps as links (ADR 0023): link previews, the preview picture and opt-in indexing.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const binary = (res, done) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => done(null, Buffer.concat(chunks)));
};

async function sharedTraveler(username) {
    const client = createClient(ctx.server);
    await client.register(username, 'sharing password');
    await client.post('/api/markers', sampleMarker);
    await client.post('/api/markers', { ...sampleMarker, name: 'Kyoto, Japan', lat: 35.0116, lng: 135.7681 });
    // The home country stays private: it must not show in the preview.
    await client.patch('/api/profile', { homeCountry: 'BRA' });
    return client;
}

test('a public map gets its own link preview, and private or missing maps get the generic page', async () => {
    const client = await sharedTraveler('previewer');
    const privatePage = await request(ctx.server).get('/?u=previewer').set('Host', 'travel.test');
    assert.equal(privatePage.headers['x-robots-tag'], 'noindex');
    assert.doesNotMatch(privatePage.text, /og:image/);
    assert.match(privatePage.text, /<title[^>]*>TravelMapster: travel map and Schengen day ledger<\/title>/);
    assert.equal((await request(ctx.server).get('/og/previewer.png')).status, 404);

    await client.patch('/api/profile', { profileVisibility: 'public' });
    const page = await request(ctx.server).get('/?u=previewer').set('Host', 'travel.test');
    assert.equal(page.status, 200);
    assert.equal(page.headers['x-robots-tag'], 'noindex', 'not indexed until the owner opts in');
    assert.match(page.text, /<title[^>]*>previewer&#39;s travel map · TravelMapster<\/title>/);
    assert.match(page.text, /<meta property="og:description" content="2 countries been to \([\d.]+% of the world\), 2 cities\./);
    assert.match(page.text, /<meta property="og:image" content="http:\/\/travel\.test\/og\/previewer\.png">/);
    assert.match(page.text, /<meta property="og:url" content="http:\/\/travel\.test\/\?u=previewer">/);
    assert.match(page.text, /<meta name="twitter:card" content="summary_large_image">/);
    assert.doesNotMatch(page.text, /rel="canonical"/);
    assert.match(page.text, /\/a\/[0-9a-f]{12}\/js\/app\.js/, 'still the app, with its asset links');

    for (const name of ['nobody', 'bad name!', '']) {
        const res = await request(ctx.server).get(`/?u=${encodeURIComponent(name)}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers['x-robots-tag'], 'noindex');
        assert.doesNotMatch(res.text, /og:image/);
    }
    assert.equal((await request(ctx.server).get('/?u=a&u=b')).headers['x-robots-tag'], 'noindex');
});

test('the preview picture is a PNG of the map, cached by its colours', async () => {
    const client = await sharedTraveler('painter');
    await client.patch('/api/profile', { profileVisibility: 'public' });
    const first = await request(ctx.server).get('/og/painter.png').buffer(true).parse(binary);
    assert.equal(first.status, 200);
    assert.equal(first.headers['content-type'], 'image/png');
    assert.match(first.headers['cache-control'], /public, max-age=3600/);
    assert.ok(first.body.subarray(0, 8).equals(PNG_SIGNATURE));
    assert.equal(first.body.readUInt32BE(16), 1200);
    assert.equal(first.body.readUInt32BE(20), 630);

    const again = await request(ctx.server).get('/og/painter.png').set('If-None-Match', first.headers.etag);
    assert.equal(again.status, 304);
    // The home country never colours the picture.
    await client.patch('/api/profile', { homeCountry: 'PER' });
    assert.equal((await request(ctx.server).get('/og/painter.png').set('If-None-Match', first.headers.etag)).status, 304);

    // Another place changes the colours, so the picture.
    await client.post('/api/markers', { ...sampleMarker, name: 'Lima, Peru', lat: -12.0464, lng: -77.0428 });
    const changed = await request(ctx.server).get('/og/painter.png').set('If-None-Match', first.headers.etag);
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.etag, first.headers.etag);

    for (const file of ['painter', 'painter.jpg', 'nobody.png', 'bad%20name.png']) {
        assert.equal((await request(ctx.server).get(`/og/${file}`)).status, 404, file);
    }
});

test('owners opt in to search engines: the sitemap lists their map and the page may be indexed', async () => {
    const client = await sharedTraveler('Findable');
    const optIn = await client.patch('/api/profile', { profileVisibility: 'public', publicIndexing: true });
    assert.equal(optIn.body.publicIndexing, true);
    assert.equal((await client.get('/api/auth/me')).body.user.publicIndexing, true);
    assert.equal((await client.patch('/api/profile', { publicIndexing: 'yes' })).status, 400);

    const page = await request(ctx.server).get('/?u=findable').set('Host', 'travel.test');
    assert.equal(page.headers['x-robots-tag'], undefined);
    assert.match(page.text, /<link rel="canonical" href="http:\/\/travel\.test\/\?u=Findable">/);
    const sitemap = await request(ctx.server).get('/sitemap.xml').set('Host', 'travel.test');
    assert.match(sitemap.text, /<loc>http:\/\/travel\.test\/\?u=Findable<\/loc>/);
    assert.doesNotMatch(sitemap.text, /previewer|painter/, 'maps that did not opt in stay out');

    // Making the map private takes it out at once, whatever the indexing choice.
    await client.patch('/api/profile', { profileVisibility: 'private' });
    assert.doesNotMatch((await request(ctx.server).get('/sitemap.xml')).text, /Findable/);
    assert.equal((await request(ctx.server).get('/?u=Findable')).headers['x-robots-tag'], 'noindex');
});
