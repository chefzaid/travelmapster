'use strict';

// "Where was I?" (public/js/ledger-evidence.js): the countries and towns of each day of a
// period, in runs of days, with the days no visit covers.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const countryOf = marker => ({ id: marker.countryId });
const place = (id, countryId, name, visits) => ({ id, countryId, name, category: 'City', type: 'visited',
    visits: visits.map(([startDate, endDate = '', ongoing = false], i) => ({ id: id * 10 + i, startDate, endDate, ongoing })) });

test('each day of a period shows its countries and towns, in runs, with the gaps', async () => {
    const { buildLedger } = await load('days.js');
    const { whereabouts } = await load('ledger-evidence.js');
    const markers = [
        place(1, 'PRT', 'Lisbon, Portugal', [['2026-05-01', '2026-05-03']]),
        place(2, 'PRT', 'Porto, Portugal', [['2026-05-02', '2026-05-03']]),
        place(3, 'ESP', 'Madrid, Spain', [['2026-05-03', '2026-05-04']])
    ];
    const ledger = buildLedger(markers, countryOf, { today: '2026-06-01', planned: [{ id: 'p', countryId: 'FRA', startDate: '2026-06-10', endDate: '2026-06-11' }] });
    assert.deepEqual(whereabouts(ledger, '2026-04-30', '2026-05-06'), [
        { from: '2026-04-30', to: '2026-04-30', days: 1, stays: [] },
        { from: '2026-05-01', to: '2026-05-01', days: 1, stays: [{ countryId: 'PRT', places: ['Lisbon'], planned: false }] },
        { from: '2026-05-02', to: '2026-05-02', days: 1, stays: [{ countryId: 'PRT', places: ['Lisbon', 'Porto'], planned: false }] },
        {
            from: '2026-05-03', to: '2026-05-03', days: 1,
            stays: [{ countryId: 'ESP', places: ['Madrid'], planned: false }, { countryId: 'PRT', places: ['Lisbon', 'Porto'], planned: false }]
        },
        { from: '2026-05-04', to: '2026-05-04', days: 1, stays: [{ countryId: 'ESP', places: ['Madrid'], planned: false }] },
        { from: '2026-05-05', to: '2026-05-06', days: 2, stays: [] }
    ]);
    assert.deepEqual(whereabouts(ledger, '2026-06-10', '2026-06-11'), [{ from: '2026-06-10', to: '2026-06-11', days: 2, stays: [{ countryId: 'FRA', places: [], planned: true }] }]);
    const decade = whereabouts(ledger, '2000-01-01', '2030-12-31');
    assert.equal(decade.at(-1).to, '2010-01-07', 'at most ten years are read');
    assert.equal(decade.reduce((sum, run) => sum + run.days, 0), 3660);
});
