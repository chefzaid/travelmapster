'use strict';

// How much of the world (public/js/world-share.js): areas on the sphere and the shares of land
// and people in the countries been to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'countries.geojson'), 'utf8'));

test('areas on the sphere match the countries\' known sizes, holes left out and across the date line', async () => {
    const { areaKm2 } = await load('world-share.js');
    const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    assert.ok(Math.abs(areaKm2({ type: 'Polygon', coordinates: [square] }) - 12_364) < 20, 'a degree square at the equator');
    const hole = [[0.25, 0.25], [0.25, 0.75], [0.75, 0.75], [0.75, 0.25], [0.25, 0.25]];
    assert.ok(Math.abs(areaKm2({ type: 'Polygon', coordinates: [square, hole] }) - 12_364 * 0.75) < 20);
    assert.equal(areaKm2({ type: 'Point', coordinates: [0, 0] }), 0);
    const known = { RUS: 17_098_246, CAN: 9_984_670, FRA: 551_695, FJI: 18_274 };
    for (const [id, size] of Object.entries(known)) {
        const area = areaKm2(geojson.features.find(feature => feature.properties.id === id).geometry);
        assert.ok(Math.abs(area - size) / size < 0.05, `${id}: ${Math.round(area)} km²`);
    }
});

test('the share of land and people counts every country and territory on the map', async () => {
    const { createCountryIndex } = await load('geo.js');
    const { worldShare } = await load('world-share.js');
    const index = createCountryIndex(geojson);
    assert.deepEqual(worldShare(index.countries, new Set()), { land: 0, people: 0 });
    const { land, people } = worldShare(index.countries, new Set(['RUS', 'CHN']));
    assert.ok(land > 0.17 && land < 0.2, `Russia and China are about a fifth of the land: ${land}`);
    assert.ok(people > 0.17 && people < 0.21, `and about a fifth of the people: ${people}`);
    assert.deepEqual(worldShare([], new Set(['RUS'])), { land: 0, people: 0 });
});
