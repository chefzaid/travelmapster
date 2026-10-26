'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('only the public/ directory is served', async () => {
    const http = request(ctx.app);
    for (const path of ['/markers.db', '/server.js', '/src/app.js', '/package.json', '/package-lock.json', '/.env', '/.git/config', '/../package.json']) {
        const res = await http.get(path);
        assert.equal(res.status, 404, `${path} must not be served`);
    }
    const index = await http.get('/').expect(200);
    assert.match(index.text, /<title>[^<]*TravelMapster[^<]*<\/title>/);
    await http.get('/js/app.js').expect(200);
    await http.get('/data/countries.geojson').expect(200);
    await http.get('/vendor/maplibre/maplibre-gl.mjs').expect(200);
});

test('the Schengen calculator is a public page with its own title and description', async () => {
    const http = request(ctx.app);
    const page = await http.get('/schengen-calculator').expect(200);
    assert.equal(page.headers['cache-control'], 'no-cache');
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.text, /<title>[^<]*Schengen 90\/180 calculator[^<]*<\/title>/);
    assert.match(page.text, /<meta name="description" content="[^"]{50,160}">/);
    assert.match(page.text, /<h1>/);
    assert.ok(!page.text.includes('__assets__'), 'every placeholder is rewritten');
    assert.match(page.text, /src="\/a\/[0-9a-f]{12}\/js\/calculator\.js"/);
    const old = await http.get('/schengen-calculator.html').expect(301);
    assert.equal(old.headers.location, '/schengen-calculator');
});

test('crawlers get robots.txt and a sitemap of public pages, and shared maps are not indexed by default', async () => {
    const http = request(ctx.app);
    const robots = await http.get('/robots.txt').set('Host', 'travel.test').expect(200);
    assert.match(robots.headers['content-type'], /text\/plain/);
    assert.match(robots.text, /Sitemap: http:\/\/travel\.test\/sitemap\.xml/);
    const sitemap = await http.get('/sitemap.xml').set('Host', 'travel.test').expect(200);
    assert.match(sitemap.headers['content-type'], /application\/xml/);
    assert.match(sitemap.text, /<loc>http:\/\/travel\.test\/schengen-calculator<\/loc>/);

    assert.equal((await http.get('/')).headers['x-robots-tag'], undefined);
    assert.equal((await http.get('/?u=explorer')).headers['x-robots-tag'], 'noindex');
});

test('security headers are set', async () => {
    const res = await request(ctx.app).get('/');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
});

test('health and readiness endpoints', async () => {
    await request(ctx.app).get('/healthz').expect(200, { status: 'ok' });
    await request(ctx.app).get('/readyz').expect(200, { status: 'ready' });
    ctx.state.shuttingDown = true;
    await request(ctx.app).get('/readyz').expect(503);
    ctx.state.shuttingDown = false;
});

test('unknown API routes and malformed bodies return JSON errors', async () => {
    const client = createClient(ctx.server);
    const missing = await client.get('/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'Not found.');

    const token = (await client.get('/api/csrf-token')).body.csrfToken;
    const malformed = await client.agent.post('/api/auth/login')
        .set('X-CSRF-Token', token)
        .set('Content-Type', 'application/json')
        .send('{"username":');
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.error, /valid JSON/);
});

test('profile visibility controls the public map', async () => {
    const owner = createClient(ctx.server);
    await owner.register('explorer', 'explorer password');
    await owner.post('/api/markers', sampleMarker);

    const visitor = createClient(ctx.server);
    assert.equal((await visitor.get('/api/public/explorer')).status, 404);

    assert.equal((await owner.patch('/api/profile', { profileVisibility: 'sideways' })).status, 400);
    const changed = await owner.patch('/api/profile', { profileVisibility: 'public' });
    assert.deepEqual(changed.body, { profileVisibility: 'public', homeCountry: null, countryList: 'all', mapPalette: 'standard', publicJourneys: false, publicIndexing: false, goals: [] });
    assert.equal((await owner.get('/api/auth/me')).body.user.profileVisibility, 'public');

    const profile = await visitor.get('/api/public/Explorer');
    assert.equal(profile.status, 200);
    assert.equal(profile.body.username, 'explorer');
    assert.equal(profile.body.markers.length, 1);
    assert.equal(profile.body.markers[0].notes, undefined, 'notes stay private');
    assert.equal(profile.body.markers[0].photoUrl, undefined, 'photo links stay private');

    assert.equal((await visitor.get('/api/public/nobody-here')).status, 404);
    assert.equal((await visitor.get('/api/public/bad%20name')).status, 404);
});

test('a traveler sets a home country that only they can see (ADR 0014)', async () => {
    const owner = createClient(ctx.server);
    await owner.register('homebody', 'homebody password');
    assert.equal((await owner.get('/api/auth/me')).body.user.homeCountry, null);

    const set = await owner.patch('/api/profile', { homeCountry: 'PRT' });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body, { profileVisibility: 'private', homeCountry: 'PRT', countryList: 'all', mapPalette: 'standard', publicJourneys: false, publicIndexing: false, goals: [] });
    assert.equal((await owner.get('/api/auth/me')).body.user.homeCountry, 'PRT');
    // The previous release's tabs send only the visibility: the home country stays.
    await owner.patch('/api/profile', { profileVisibility: 'public' });
    assert.equal((await owner.get('/api/auth/me')).body.user.homeCountry, 'PRT');
    assert.doesNotMatch(JSON.stringify((await createClient(ctx.server).get('/api/public/homebody')).body), /PRT/);

    for (const body of [{}, { homeCountry: 'portugal' }, { homeCountry: 351 }, { homeCountry: 'PRT', profileVisibility: 'friends' }]) {
        assert.equal((await owner.patch('/api/profile', body)).status, 400, JSON.stringify(body));
    }
    await assert.rejects(ctx.pool.query("UPDATE users SET home_country = 'pt' WHERE username = 'homebody'"));
    assert.equal((await owner.patch('/api/profile', { homeCountry: null })).body.homeCountry, null);

    assert.equal((await createClient(ctx.server).patch('/api/profile', { homeCountry: 'PRT' })).status, 401);
    const forged = await owner.agent.patch('/api/profile').set('X-CSRF-Token', 'forged').send({ homeCountry: 'ESP' });
    assert.equal(forged.status, 403);
    assert.equal((await owner.get('/api/auth/me')).body.user.homeCountry, null);
});

test('a traveler picks a map palette and whether a public map shows journey lines (ADR 0016)', async () => {
    const owner = createClient(ctx.server);
    await owner.register('painter', 'painter password');
    const me = (await owner.get('/api/auth/me')).body.user;
    assert.equal(me.mapPalette, 'standard');
    assert.equal(me.publicJourneys, false, 'journey lines stay off public maps until the owner opts in');

    const set = await owner.patch('/api/profile', { mapPalette: 'colorblind', profileVisibility: 'public' });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body, { profileVisibility: 'public', homeCountry: null, countryList: 'all', mapPalette: 'colorblind', publicJourneys: false, publicIndexing: false, goals: [] });
    assert.equal((await owner.get('/api/auth/me')).body.user.mapPalette, 'colorblind');
    const visitor = createClient(ctx.server);
    const shared = (await visitor.get('/api/public/painter')).body;
    assert.equal(shared.showJourneys, false);
    assert.equal(shared.mapPalette, undefined, 'visitors choose their own colors');

    assert.equal((await owner.patch('/api/profile', { publicJourneys: true })).body.publicJourneys, true);
    assert.equal((await owner.get('/api/auth/me')).body.user.publicJourneys, true);
    assert.equal((await visitor.get('/api/public/painter')).body.showJourneys, true);
    // The previous release's tabs send only the visibility: the display settings stay.
    await owner.patch('/api/profile', { profileVisibility: 'public' });
    assert.equal((await owner.get('/api/auth/me')).body.user.mapPalette, 'colorblind');

    for (const body of [{ mapPalette: 'neon' }, { mapPalette: null }, { publicJourneys: 'yes' }, { publicJourneys: true, mapPalette: 'Print' }]) {
        assert.equal((await owner.patch('/api/profile', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await owner.get('/api/auth/me')).body.user.publicJourneys, true, 'a refused change changes nothing');
    await assert.rejects(ctx.pool.query("UPDATE users SET map_palette = 'neon' WHERE username = 'painter'"));
    // The previous release creates accounts without the columns.
    await ctx.pool.query("INSERT INTO users (username, password_hash) VALUES ('old_palette_user', 'x')");
    const { rows: [old] } = await ctx.pool.query("SELECT map_palette, public_journeys FROM users WHERE username = 'old_palette_user'");
    assert.deepEqual(old, { map_palette: 'standard', public_journeys: false });

    assert.equal((await createClient(ctx.server).patch('/api/profile', { mapPalette: 'print' })).status, 401);
    const forged = await owner.agent.patch('/api/profile').set('X-CSRF-Token', 'forged').send({ mapPalette: 'print' });
    assert.equal(forged.status, 403);
    assert.equal((await owner.get('/api/auth/me')).body.user.mapPalette, 'colorblind');
});

test('a traveler chooses the list of countries to count, which a public map shares (ADR 0015)', async () => {
    const owner = createClient(ctx.server);
    await owner.register('counter', 'counter password');
    assert.equal((await owner.get('/api/auth/me')).body.user.countryList, 'all', 'every territory counts, as before');

    const set = await owner.patch('/api/profile', { countryList: 'un', profileVisibility: 'public' });
    assert.deepEqual(set.body, { profileVisibility: 'public', homeCountry: null, countryList: 'un', mapPalette: 'standard', publicJourneys: false, publicIndexing: false, goals: [] });
    assert.equal((await owner.get('/api/auth/me')).body.user.countryList, 'un');
    const shared = await createClient(ctx.server).get('/api/public/counter');
    assert.equal(shared.body.countryList, 'un', 'visitors count the way the owner does');

    for (const countryList of ['tcc', 'UN', null, 7]) {
        assert.equal((await owner.patch('/api/profile', { countryList })).status, 400, String(countryList));
    }
    await assert.rejects(ctx.pool.query("UPDATE users SET country_list = 'tcc' WHERE username = 'counter'"));
    // The previous release creates accounts without the column.
    await ctx.pool.query("INSERT INTO users (username, password_hash) VALUES ('old_release_user', 'x')");
    const { rows: [old] } = await ctx.pool.query("SELECT country_list FROM users WHERE username = 'old_release_user'");
    assert.equal(old.country_list, 'all');

    assert.equal((await createClient(ctx.server).patch('/api/profile', { countryList: 'all' })).status, 401);
    const forged = await owner.agent.patch('/api/profile').set('X-CSRF-Token', 'forged').send({ countryList: 'all' });
    assert.equal(forged.status, 403);
    assert.equal((await owner.get('/api/auth/me')).body.user.countryList, 'un');
});

test('geocode proxy requires login, validates input and hides upstream failures', async () => {
    const client = createClient(ctx.server);
    assert.equal((await client.get('/api/geocode?q=Paris')).status, 401);

    await client.register('geo', 'geocoding password');
    const ok = await client.get('/api/geocode?q=Paris&kind=city&limit=3');
    assert.equal(ok.status, 200);
    assert.equal(ok.body[0].name, 'Paris, Testland');
    assert.deepEqual(ctx.geocoder.calls.at(-1), { query: 'Paris', kind: 'city', limit: 3 });

    assert.equal((await client.get('/api/geocode?q=P')).status, 400);
    assert.equal((await client.get('/api/geocode?q=Paris&kind=planet')).status, 400);

    ctx.geocoder.failNext = true;
    const failed = await client.get('/api/geocode?q=Paris');
    assert.equal(failed.status, 502);
});

test('migrations are recorded and idempotent', async () => {
    const { migrate, listMigrations } = require('../../src/db/migrate');
    const { createLogger } = require('../../src/logger');
    assert.deepEqual(await migrate(ctx.pool, createLogger('silent')), []);
    const { rows } = await ctx.pool.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(rows.map(row => row.version), listMigrations().map(migration => migration.version));
});

test('the shared geocoder throttle spaces requests from every replica', async () => {
    const { createPgSlots } = require('../../src/services/geocoder');
    const firstReplica = createPgSlots(ctx.pool, 200);
    const secondReplica = createPgSlots(ctx.pool, 200);
    const waits = [await firstReplica(), await secondReplica(), await firstReplica()];
    assert.ok(waits[0] < 50, `the first request starts at once (${waits[0]} ms)`);
    assert.ok(waits[1] > 120 && waits[1] <= 200, `the next waits one interval (${waits[1]} ms)`);
    assert.ok(waits[2] > 320 && waits[2] <= 400, `the third waits two intervals (${waits[2]} ms)`);
});

test('place search finds every town, not just the big cities', async () => {
    const client = createClient(ctx.server);
    const small = await client.get('/api/places?q=melun');
    assert.equal(small.status, 200);
    assert.equal(small.body[0].name, 'Melun');
    assert.equal(small.body[0].country, 'France');
    assert.ok(small.body[0].minZoom > 6, 'a town the browser does not load up front');

    const filtered = await client.get(`/api/places?q=${encodeURIComponent('paris, united')}`);
    assert.ok(filtered.body.length > 0);
    assert.ok(filtered.body.every(place => place.country === 'United States of America'));

    assert.equal((await client.get('/api/places?q=x')).status, 400);
});

test('static files always revalidate so a release never mixes old and new assets', async () => {
    const first = await request(ctx.server).get('/js/map.js');
    assert.equal(first.status, 200);
    assert.equal(first.headers['cache-control'], 'no-cache');
    assert.ok(first.headers.etag);
    const again = await request(ctx.server).get('/js/map.js').set('If-None-Match', first.headers.etag);
    assert.equal(again.status, 304, 'unchanged files cost a 304, not a download');
});

test('the page links this release\'s assets under a fingerprinted, long-cached path', async () => {
    const page = await request(ctx.server).get('/');
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-cache');
    assert.ok(!page.text.includes('__assets__'), 'every placeholder is rewritten');
    const script = page.text.match(/src="(\/a\/[0-9a-f]{12}\/js\/app\.js)"/)?.[1];
    assert.ok(script, 'the app script is fingerprinted');

    const asset = await request(ctx.server).get(script);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal((await request(ctx.server).get(script.replace('js/app.js', '../src/server.js'))).status, 404);
});
