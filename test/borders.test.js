'use strict';

// Land borders (public/js/borders.js) from the shared vertices of the map's shapes, and the
// countries one border away from those been to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'countries.geojson'), 'utf8'));

test('neighbors are the countries sharing a land border on the map', async () => {
    const { createCountryIndex } = await load('geo.js');
    const { landNeighbors } = await load('borders.js');
    const { countries } = createCountryIndex(geojson);
    const neighbors = landNeighbors(countries);
    const of = id => [...neighbors.get(id)].sort();
    assert.deepEqual(of('PRT'), ['ESP']);
    assert.deepEqual(of('USA'), ['CAN', 'MEX']);
    assert.deepEqual(of('JPN'), [], 'islands have none');
    for (const id of ['AND', 'BEL', 'CHE', 'DEU', 'ESP', 'ITA', 'LUX']) assert.ok(neighbors.get('FRA').has(id), `France borders ${id}`);
    for (const [id, set] of neighbors) for (const other of set) assert.ok(neighbors.get(other).has(id), `${id} and ${other} both ways`);
    assert.equal(landNeighbors(countries), neighbors, 'worked out once');
});

test('one border away lists unvisited neighbors, those next to the most first', async () => {
    const { createCountryIndex } = await load('geo.js');
    const { oneBorderAway } = await load('borders.js');
    const { countries } = createCountryIndex(geojson);
    const list = oneBorderAway(countries, new Set(['FRA', 'DEU', 'PRT']));
    const ids = list.map(item => item.country.id);
    assert.ok(!ids.includes('FRA') && !ids.includes('PRT'), 'never a country been to');
    assert.deepEqual(list.slice(0, 4).map(item => [item.country.id, item.via.map(country => country.id)]), [
        ['BEL', ['FRA', 'DEU']], ['LUX', ['FRA', 'DEU']], ['ESP', ['FRA', 'PRT']], ['CHE', ['FRA', 'DEU']]
    ]);
    assert.deepEqual(oneBorderAway(countries, new Set(['JPN'])), []);
});
