'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PUBLIC_PAGES, robotsTxt, sitemapXml, siteOrigin } = require('../../src/seo');

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
    assert.ok(!xml.includes('?u='), 'shared user maps are not listed');
    assert.match(sitemapXml('https://a.example', ['/?a=1&b=<2>']), /<loc>https:\/\/a\.example\/\?a=1&#38;b=&#60;2&#62;<\/loc>/);
});

test('the origin comes from PUBLIC_URL, or else from the request', () => {
    const req = { protocol: 'http', get: name => (name === 'host' ? 'localhost:3000' : undefined) };
    assert.equal(siteOrigin({ publicUrl: 'https://travel.example.org' }, req), 'https://travel.example.org');
    assert.equal(siteOrigin({ publicUrl: null }, req), 'http://localhost:3000');
});
