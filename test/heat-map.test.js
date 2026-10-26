'use strict';

// Days on the map (public/js/heat-map.js): days recorded per country, their steps and the
// legend's counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const countryOf = marker => ({ id: marker.countryId });
const place = (id, countryId, visits) => ({ id, countryId, name: `Place ${id}`, category: 'City', type: 'visited',
    visits: visits.map(([startDate, endDate = ''], i) => ({ id: id * 10 + i, startDate, endDate })) });

test('a country\'s step follows a month, 90 days and 183 days', async () => {
    const { heatLevel } = await load('heat-map.js');
    assert.deepEqual([0, 1, 29, 30, 89, 90, 182, 183, 400].map(heatLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('days are counted per country for all time or a period, without planned stays', async () => {
    const { buildLedger } = await load('days.js');
    const { recordedDays } = await load('heat-map.js');
    const markers = [
        place(1, 'PRT', [['2025-12-30', '2026-01-02']]),
        place(2, 'PRT', [['2026-01-01', '2026-01-02']]),
        place(3, 'ESP', [['2026-03-01', '2026-03-31']])
    ];
    const ledger = buildLedger(markers, countryOf, { today: '2026-06-01', planned: [{ id: 'p', countryId: 'FRA', startDate: '2026-05-01', endDate: '2026-05-03' }] });
    assert.deepEqual([...recordedDays(ledger, { to: '2026-06-01' })], [['PRT', 4], ['ESP', 31]], 'overlapping visits count each day once');
    assert.deepEqual([...recordedDays(ledger, { from: '2026-01-01', to: '2026-03-10' })], [['PRT', 2], ['ESP', 10]]);
    assert.deepEqual([...recordedDays(ledger, { to: '2025-12-31' })], [['PRT', 2]]);
});

test('the legend counts the countries in each step', async () => {
    const { heatLegend } = await load('heat-map.js');
    const { useCatalog } = await load('i18n.js');
    useCatalog('en');
    assert.deepEqual(heatLegend(new Map([['PRT', 4], ['ESP', 31], ['FRA', 45], ['DEU', 1200]])), [
        { level: 1, label: '1–29 days', countries: 1 },
        { level: 2, label: '30–89 days', countries: 2 },
        { level: 3, label: '90–182 days', countries: 0 },
        { level: 4, label: '183+ days', countries: 1 }
    ]);
});
