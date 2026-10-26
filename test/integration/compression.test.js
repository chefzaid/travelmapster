'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const publicDir = path.join(__dirname, '..', '..', 'public');

// Raw bytes and headers, without any client decoding.
function get(urlPath, headers = {}, method = 'GET') {
    const { port } = ctx.server.address();
    return new Promise((resolve, reject) => {
        http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject).end();
    });
}

test('static files go out Brotli-compressed to browsers that accept it, cached like the rest', async () => {
    const version = (await get('/')).body.toString().match(/\/a\/([0-9a-f]{12})\//)[1];
    const raw = fs.readFileSync(path.join(publicDir, 'data', 'countries.geojson'));

    const packed = await get(`/a/${version}/data/countries.geojson`, { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(packed.status, 200);
    assert.equal(packed.headers['content-encoding'], 'br');
    assert.match(packed.headers['content-type'], /geo\+json/);
    assert.match(packed.headers.vary, /Accept-Encoding/);
    assert.equal(packed.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.ok(packed.body.length < raw.length / 2);
    assert.deepEqual(zlib.brotliDecompressSync(packed.body), raw);

    const tile = await get(`/a/${version}/data/cities/t01.json`, { 'Accept-Encoding': 'br' });
    assert.equal(tile.headers['content-encoding'], 'br');
    assert.match(tile.headers['content-type'], /json/);

    const plain = await get(`/a/${version}/data/countries.geojson`, { 'Accept-Encoding': 'gzip' });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.match(plain.headers.vary, /Accept-Encoding/);
    assert.deepEqual(plain.body, raw);

    // Unversioned paths revalidate; HEAD answers too; anything else falls through.
    const unversioned = await get('/data/cities.json', { 'Accept-Encoding': 'br' });
    assert.equal(unversioned.headers['content-encoding'], 'br');
    assert.equal(unversioned.headers['cache-control'], 'no-cache');
    assert.equal((await get('/data/cities.json', { 'Accept-Encoding': 'br' }, 'HEAD')).headers['content-encoding'], 'br');
    assert.equal((await get('/data/missing.json', { 'Accept-Encoding': 'br' })).status, 404);
    assert.equal((await get('/data/../src/app.js', { 'Accept-Encoding': 'br' })).status, 404);

    // Scripts, styles and the MapLibre bundle are compressed on their first request.
    for (const file of ['js/app.js', 'css/tokens.css', 'vendor/maplibre/maplibre-gl-shared.mjs']) {
        const response = await get(`/a/${version}/${file}`, { 'Accept-Encoding': 'br' });
        assert.equal(response.headers['content-encoding'], 'br', file);
        assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable', file);
        assert.deepEqual(zlib.brotliDecompressSync(response.body), fs.readFileSync(path.join(publicDir, file)), file);
    }
    assert.match((await get(`/a/${version}/js/app.js`, { 'Accept-Encoding': 'br' })).headers['content-type'], /javascript/);
    // Fonts are compressed already; pages stay as they are.
    assert.equal((await get(`/a/${version}/vendor/fonts/fredoka-latin-wght-normal.woff2`, { 'Accept-Encoding': 'br' })).headers['content-encoding'], undefined);
    assert.equal((await get('/', { 'Accept-Encoding': 'br' })).headers['content-encoding'], undefined);
});
