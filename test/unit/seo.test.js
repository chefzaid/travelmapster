'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PUBLIC_PAGES, pageWithMeta, robotsTxt, sitemapXml, siteOrigin } = require('../../src/seo');

test('robots.txt keeps crawlers off the API and points at the sitemap', () => {
    const robots = robotsTxt('https://travel.example.org');
    assert.match(robots, /^User-agent: \*$/m);
    assert.match(robots, /^Disallow: \/api\/$/m);
    assert.match(robots, /^Sitemap: https:\/\/travel\.example\.org\/sitemap\.xml$/m);
});

test('the sitemap lists every public page and escapes the origin', () => {
    const xml = sitemapXml('https://travel.example.org');
    assert.deepEqual(PUBLIC_PAGES, ['/', '/schengen-calculator']);
    assert.match(xml, /<loc>https:\/\/travel\.example\.org\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/travel\.example\.org\/schengen-calculator<\/loc>/);
    assert.ok(!xml.includes('?u='), 'shared maps are listed only when the app passes them');
    assert.match(sitemapXml('https://a.example', ['/?a=1&b=<2>']), /<loc>https:\/\/a\.example\/\?a=1&#38;b=&#60;2&#62;<\/loc>/);
});

test('the origin comes from PUBLIC_URL, or else from the request', () => {
    const req = { protocol: 'http', get: name => (name === 'host' ? 'localhost:3000' : undefined) };
    assert.equal(siteOrigin({ publicUrl: 'https://travel.example.org' }, req), 'https://travel.example.org');
    assert.equal(siteOrigin({ publicUrl: null }, req), 'http://localhost:3000');
});

test('a shared map\'s page gets its own escaped title, description and preview tags', () => {
    const html = ['<head>', '<meta name="description" content="Generic">', '<meta property="og:title" content="Generic">',
        '<meta property="og:description" content="Generic">', '<title>Generic</title>', '</head><body></body>'].join('\n');
    const meta = { title: 'A & B\'s map', description: 'Use $1 and "quotes" <here>', url: 'https://t.example/?u=a', image: 'https://t.example/og/a.png', imageAlt: 'Map', indexed: false };
    const page = pageWithMeta(html, meta);
    assert.match(page, /<title>A &#38; B&#39;s map<\/title>/);
    assert.match(page, /<meta name="description" content="Use \$1 and &#34;quotes&#34; &#60;here&#62;">/);
    assert.match(page, /<meta property="og:title" content="A &#38; B&#39;s map">/);
    assert.match(page, /<meta property="og:image" content="https:\/\/t\.example\/og\/a\.png">\n/);
    assert.ok(page.indexOf('twitter:card') < page.indexOf('</head>'));
    assert.ok(!page.includes('canonical'));
    assert.match(pageWithMeta(html, { ...meta, indexed: true }), /<link rel="canonical" href="https:\/\/t\.example\/\?u=a">/);
});
