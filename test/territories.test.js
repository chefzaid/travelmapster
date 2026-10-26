// Overseas territories outside the Schengen area that the map draws on their own (ADR 0024).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const load = file => import(path.join(publicDir, 'js', file));
const countries = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'countries.geojson'), 'utf8'));

const TERRITORIES = {
    GUF: ['French Guiana', 'GF', 'South America'], GLP: ['Guadeloupe', 'GP', 'North America'],
    MTQ: ['Martinique', 'MQ', 'North America'], REU: ['Réunion', 'RE', 'Africa'], MYT: ['Mayotte', 'YT', 'Africa'],
    SJM: ['Svalbard', 'SJ', 'Europe'], BES: ['Caribbean Netherlands', 'BQ', 'North America']
};
const place = (id, lat, lng, extra = {}) => ({ id, lat, lng, type: 'visited', category: 'City', name: `Place ${id}`, ...extra });
const CAYENNE = [4.93, -52.33];
const SAINT_DENIS = [-20.88, 55.45];
const LONGYEARBYEN = [78.22, 15.65];
const KRALENDIJK = [12.15, -68.27];
const PARIS = [48.86, 2.35];

test('overseas parts of France, Norway and the Netherlands are territories of their own', async () => {
    const { createCountryIndex, resolveMarkerCountry } = await load('geo.js');
    const index = createCountryIndex(countries);
    for (const [id, [name, iso2, continent]] of Object.entries(TERRITORIES)) {
        const country = index.byId.get(id);
        assert.deepEqual([country?.name, country?.iso2, country?.continent], [name, iso2, continent], id);
    }
    const at = ([lat, lng]) => resolveMarkerCountry(index, place(1, lat, lng))?.id;
    assert.deepEqual([CAYENNE, SAINT_DENIS, LONGYEARBYEN, KRALENDIJK, PARIS].map(at), ['GUF', 'REU', 'SJM', 'BES', 'FRA']);
    assert.equal(index.findByName('Svalbard Islands')?.id, 'SJM', 'found by their other names');
});

test('days in an overseas territory are not Schengen days', async () => {
    const { createCountryIndex, resolveMarkerCountry } = await load('geo.js');
    const { SCHENGEN_AREA, buildLedger, daysIn } = await load('days.js');
    const index = createCountryIndex(countries);
    const markers = [
        place(1, ...CAYENNE, { visits: [{ id: 1, startDate: '2026-01-01', endDate: '2026-01-10' }] }),
        place(2, ...PARIS, { visits: [{ id: 2, startDate: '2026-02-01', endDate: '2026-02-03' }] })
    ];
    const ledger = buildLedger(markers, marker => resolveMarkerCountry(index, marker), { today: '2026-03-01' });
    assert.equal(daysIn(ledger, SCHENGEN_AREA).length, 3);
    assert.equal(daysIn(ledger, ['GUF']).length, 10);
    assert.ok(Object.keys(TERRITORIES).every(id => !SCHENGEN_AREA.includes(id)));
});

test('the UN list counts a member for its overseas parts; the full list counts each territory', async () => {
    const { createCountryIndex, computeStats } = await load('geo.js');
    const lists = await load('lists.js');
    const index = createCountryIndex(countries);
    assert.deepEqual(Object.keys(lists.MEMBER_PARTS).sort(), Object.keys(TERRITORIES).sort());
    assert.ok(Object.values(lists.MEMBER_PARTS).every(id => lists.UN_MEMBERS.includes(id)));

    const reunionOnly = [place(1, ...SAINT_DENIS)];
    const un = computeStats(reunionOnly, index, { countryList: 'un' });
    assert.deepEqual([un.visitedCountries, un.uncountedIds], [1, []], 'Réunion counts France');
    assert.deepEqual(un.continents.filter(c => c.visited).map(c => c.name), ['Europe']);
    assert.ok(un.visitedIds.has('REU'), 'the map still colors Réunion');
    const all = computeStats(reunionOnly, index);
    assert.equal(all.visitedCountries, 1);
    assert.ok(!all.visitedIds.has('FRA'));

    // A visit to France wins over a layover in French Guiana and a wish for Martinique.
    const mixed = [
        place(1, ...PARIS),
        place(2, ...CAYENNE, { stay: 'transit' }),
        place(3, 14.65, -61.0, { type: 'wishlist' }),
        place(4, ...LONGYEARBYEN, { stay: 'transit' }),
        place(5, ...KRALENDIJK, { type: 'wishlist' })
    ];
    const counted = computeStats(mixed, index, { countryList: 'un' });
    assert.deepEqual([counted.visitedCountries, counted.transitCountries, counted.wishlistCountries], [1, 1, 1]);
    const everywhere = computeStats(mixed, index);
    assert.deepEqual([everywhere.visitedCountries, everywhere.transitCountries, everywhere.wishlistCountries], [1, 2, 2]);
});
