// Unit tests for comparing two travelers' countries (public/js/compare.js, ADR 0028).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const load = file => import(path.join(publicDir, 'js', file));

test('countries split into both, only mine and only theirs, by name', async () => {
    const { compareCountries } = await load('compare.js');
    const names = { FRA: 'France', JPN: 'Japan', BRA: 'Brazil', ESP: 'Spain', AUT: 'Austria' };
    const result = compareCountries(new Set(['JPN', 'FRA', 'ESP']), new Set(['FRA', 'BRA', 'AUT', 'JPN']), id => names[id]);
    assert.deepEqual(result, { both: ['FRA', 'JPN'], onlyMine: ['ESP'], onlyTheirs: ['AUT', 'BRA'] });
    assert.deepEqual(compareCountries(new Set(), new Set(), id => id), { both: [], onlyMine: [], onlyTheirs: [] });
});

test('the passport counts the countries to compare on the traveler\'s list', async () => {
    const { createCountryIndex, computeStats } = await load('geo.js');
    const index = createCountryIndex(JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'countries.geojson'), 'utf8')));
    const markers = [
        { id: 1, lat: 42.6, lng: 21.0, type: 'visited', name: 'Kosovo', category: 'Country' },
        { id: 2, lat: -20.88, lng: 55.45, type: 'visited', name: 'Saint-Denis', category: 'City' }
    ];
    assert.deepEqual([...computeStats(markers, index).countedVisitedIds].sort(), ['KOS', 'REU']);
    assert.deepEqual([...computeStats(markers, index, { countryList: 'un' }).countedVisitedIds], ['FRA'], 'Réunion counts France on the UN list');
});
