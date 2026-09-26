'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeocoder } = require('../../src/services/geocoder');

const options = { baseUrl: 'https://geo.test', userAgent: 'TravelMapster/test', minIntervalMs: 0, timeoutMs: 1000, cacheSize: 2 };

function fakeFetch(body, status = 200) {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url: new URL(url), init });
        return { ok: status < 400, status, json: async () => body };
    };
    return { impl, calls };
}

test('city results are normalized and sent with an identifying User-Agent', async () => {
    const { impl, calls } = fakeFetch([
        { lat: '41.9', lon: '12.5', display_name: 'Rome, Lazio, Italy', address: { city: 'Rome', country: 'Italy' } },
        { lat: 'x', lon: '1', address: { town: 'Broken' } }
    ]);
    const geocoder = createGeocoder(options, impl);
    const places = await geocoder.search('Rome', 'city', 5);
    assert.deepEqual(places, [{ name: 'Rome, Italy', city: 'Rome', country: 'Italy', displayName: 'Rome, Lazio, Italy', lat: 41.9, lng: 12.5 }]);
    assert.equal(calls[0].init.headers['User-Agent'], 'TravelMapster/test');
    assert.equal(calls[0].url.searchParams.get('featureType'), 'settlement');
});

test('country lookups use the country name and are cached', async () => {
    const { impl, calls } = fakeFetch([{ lat: '46', lon: '2', name: 'France', address: { country: 'France' } }]);
    const geocoder = createGeocoder(options, impl);
    assert.equal((await geocoder.search('france', 'country', 1))[0].name, 'France');
    await geocoder.search('FRANCE', 'country', 1);
    assert.equal(calls.length, 1, 'second lookup served from cache');
    assert.equal(calls[0].url.searchParams.get('featureType'), 'country');
});

test('the cache evicts the least recently used entry', async () => {
    const { impl, calls } = fakeFetch([]);
    const geocoder = createGeocoder(options, impl);
    await geocoder.search('a1', 'city', 1);
    await geocoder.search('b1', 'city', 1);
    await geocoder.search('a1', 'city', 1);
    await geocoder.search('c1', 'city', 1);
    await geocoder.search('a1', 'city', 1);
    await geocoder.search('b1', 'city', 1);
    assert.deepEqual(calls.map(call => call.url.searchParams.get('q')), ['a1', 'b1', 'c1', 'b1']);
});

test('requests are spaced by the minimum interval', async () => {
    const { impl, calls } = fakeFetch([]);
    const geocoder = createGeocoder({ ...options, minIntervalMs: 50 }, impl);
    const started = Date.now();
    await Promise.all([geocoder.search('x1', 'city', 1), geocoder.search('x2', 'city', 1), geocoder.search('x3', 'city', 1)]);
    assert.equal(calls.length, 3);
    assert.ok(Date.now() - started >= 95, 'three requests need at least two intervals');
});

test('upstream errors propagate and do not poison the queue', async () => {
    let fail = true;
    const impl = async () => (fail
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => [] });
    const geocoder = createGeocoder(options, impl);
    await assert.rejects(geocoder.search('down', 'city', 1), /HTTP 503/);
    fail = false;
    assert.deepEqual(await geocoder.search('up', 'city', 1), []);
});
