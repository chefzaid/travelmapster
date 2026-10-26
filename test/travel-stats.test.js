// Unit tests for the passport's travel statistics (public/js/travel-stats.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

const COUNTRIES = {
    PRT: { id: 'PRT', label: [39.5, -8] },
    ESP: { id: 'ESP', label: [40.2, -3.6] },
    FRA: { id: 'FRA', label: [46.6, 2.4] },
    JPN: { id: 'JPN', label: [36.5, 138] }
};

const city = (id, name, countryId, lat, lng, visits, fields = {}) => ({
    id, name, category: 'City', countryId, lat, lng, type: 'visited', stay: 'visit', visits, ...fields
});
const country = (id, countryId, visits, fields = {}) => ({
    id, name: countryId, category: 'Country', countryId, lat: 0, lng: 0, type: 'visited', stay: 'visit', visits, ...fields
});
const countryOf = marker => COUNTRIES[marker.countryId];

const markers = [
    country(1, 'PRT', [{ startDate: '2020-01-01', endDate: '2024-12-31' }], { stay: 'lived' }),
    city(2, 'Madrid, Spain', 'ESP', 40.42, -3.70, [{ startDate: '2023-05-01', endDate: '2023-05-04' }]),
    city(3, 'Paris, France', 'FRA', 48.86, 2.35, [{ startDate: '2023-05-06', endDate: '2023-05-10' }, { startDate: '2025-03-01', endDate: '2025-03-02' }]),
    country(4, 'JPN', [{ startDate: '2024-10-01', endDate: '2024-10-21' }]),
    city(5, 'Tokyo, Japan', 'JPN', 35.68, 139.69, [], { type: 'wishlist' })
];

test('distances are great-circle kilometers', async () => {
    const { distanceKm } = await load('travel-stats.js');
    assert.equal(Math.round(distanceKm({ lat: 48.86, lng: 2.35 }, { lat: 51.51, lng: -0.13 })), 343);
    assert.equal(distanceKm({ lat: 10, lng: 20 }, { lat: 10, lng: 20 }), 0);
    assert.equal(Math.round(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })), 20015);
});

test('days away from home are counted per year, up to today', async () => {
    const { buildLedger } = await load('days.js');
    const { daysAwayByYear } = await load('travel-stats.js');
    const ledger = buildLedger([...markers, country(6, 'ESP', [{ startDate: '2026-12-30', endDate: '2027-01-02' }])], countryOf, { today: '2026-12-31' });
    assert.deepEqual(daysAwayByYear(ledger, 'PRT', '2026-12-31'), [
        { year: '2023', count: 4 + 5 }, { year: '2024', count: 21 }, { year: '2025', count: 2 }, { year: '2026', count: 2 }
    ]);
    // Without a home country, every recorded day counts.
    const all = daysAwayByYear(ledger, null, '2026-12-31');
    assert.equal(all.find(row => row.year === '2021').count, 365);
    assert.equal(all.find(row => row.year === '2023').count, 365);
});

test('the longest trip joins stays a few days apart and leaves home, lived-in places and wishes out', async () => {
    const { longestTrip } = await load('travel-stats.js');
    assert.deepEqual(longestTrip(markers, { countryOf, homeId: 'PRT', today: '2026-06-01' }), {
        startDate: '2024-10-01', endDate: '2024-10-21', days: 21, route: 'JPN'
    });
    const shorter = markers.filter(marker => marker.id !== 4);
    assert.deepEqual(longestTrip(shorter, { countryOf, homeId: 'PRT', today: '2026-06-01' }), {
        startDate: '2023-05-01', endDate: '2023-05-10', days: 10, route: 'Madrid → Paris'
    });
    // A trip in the home country is not a trip away.
    assert.equal(longestTrip([markers[1]], { countryOf, homeId: 'ESP', today: '2026-06-01' }), null);
    assert.equal(longestTrip([], { countryOf, homeId: null, today: '2026-06-01' }), null);
});

test('the distance follows every place been to in the order of the visits', async () => {
    const { distanceKm, distanceTraveled } = await load('travel-stats.js');
    const stop = (lat, lng) => ({ lat, lng });
    const paris = stop(48.86, 2.35);
    const madrid = stop(40.42, -3.70);
    const portugal = stop(39.5, -8);
    const japan = stop(36.5, 138);
    // Portugal (lived, from 2020) → Madrid → Paris → Japan → Paris.
    const expected = distanceKm(portugal, madrid) + distanceKm(madrid, paris) + distanceKm(paris, japan) + distanceKm(japan, paris);
    assert.equal(distanceTraveled(markers, { countryOf, today: '2026-06-01' }), Math.round(expected));
    assert.equal(distanceTraveled([markers[1]], { countryOf, today: '2026-06-01' }), 0);
});

test('countries per year count visits and moves on the chosen list, with the new ones', async () => {
    const { countriesByYear } = await load('travel-stats.js');
    assert.deepEqual(countriesByYear(markers, { countryOf }), [
        { year: '2020', count: 1, newCount: 1 },
        { year: '2023', count: 2, newCount: 2 },
        { year: '2024', count: 1, newCount: 1 },
        { year: '2025', count: 1, newCount: 0 }
    ]);
    const transit = city(7, 'Doha, Qatar', 'QAT', 25.3, 51.5, [{ startDate: '2022-01-01' }], { stay: 'transit' });
    assert.deepEqual(countriesByYear([...markers, transit], { countryOf: marker => COUNTRIES[marker.countryId] || { id: marker.countryId }, countedIds: new Set(['ESP', 'FRA']) }), [
        { year: '2023', count: 2, newCount: 2 },
        { year: '2025', count: 1, newCount: 0 }
    ]);
});
