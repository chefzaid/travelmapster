'use strict';

// Ledger health (public/js/ledger-checks.js): ends never recorded, "still there" after being
// elsewhere, and countries far apart on the same days.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const countryOf = marker => ({ id: marker.countryId });
const place = (id, countryId, name, visits) => ({ id, countryId, name, category: 'City', type: 'visited',
    visits: visits.map(([startDate, endDate = '', ongoing = false], i) => ({ id: id * 10 + i, startDate, endDate, ongoing })) });
const NEIGHBORS = new Set(['ESP|PRT', 'PRT|ESP']);
const areNeighbors = (a, b) => NEIGHBORS.has(`${a}|${b}`);

test('a clean ledger has nothing to point out, travel days included', async () => {
    const { buildLedger } = await load('days.js');
    const { ledgerHealth, healthCount } = await load('ledger-checks.js');
    const ledger = buildLedger([
        place(1, 'PRT', 'Lisbon, Portugal', [['2026-05-01', '2026-05-05']]),
        place(2, 'JPN', 'Tokyo, Japan', [['2026-05-05', '2026-05-12']]),
        place(3, 'ESP', 'Vigo, Spain', [['2026-04-29', '2026-05-02']])
    ], countryOf, { today: '2026-06-01' });
    const health = ledgerHealth(ledger, { areNeighbors });
    assert.equal(healthCount(health), 0, 'one shared travel day, and neighbors on the same days');
});

test('ends never recorded, a stay still open after leaving, and countries far apart for days', async () => {
    const { buildLedger } = await load('days.js');
    const { ledgerHealth, healthCount } = await load('ledger-checks.js');
    const ledger = buildLedger([
        place(1, 'PRT', 'Lisbon, Portugal', [['2026-03-01', '', true]]),
        place(2, 'JPN', 'Tokyo, Japan', [['2026-04-10', '2026-04-14']]),
        place(3, 'BRA', 'Rio, Brazil', [['2026-04-12', '2026-04-13']]),
        place(4, 'ESP', 'Madrid, Spain', [['2026-05-20']])
    ], countryOf, { today: '2026-06-01' });
    const { unrecorded, stillThere, clashes } = ledgerHealth(ledger, { areNeighbors });
    assert.deepEqual(unrecorded.map(visit => visit.place), ['Madrid, Spain']);
    assert.deepEqual(stillThere.map(({ visit, since }) => [visit.place, since.place]), [['Lisbon, Portugal', 'Tokyo, Japan']], 'Spain is next door, Japan is not');
    assert.deepEqual(clashes, [
        { countries: ['BRA', 'JPN'], from: '2026-04-12', to: '2026-04-13', days: 2 },
        { countries: ['JPN', 'PRT'], from: '2026-04-10', to: '2026-04-14', days: 5 },
        { countries: ['BRA', 'PRT'], from: '2026-04-12', to: '2026-04-13', days: 2 }
    ].sort((a, b) => a.from.localeCompare(b.from) || a.countries.join().localeCompare(b.countries.join())));
    assert.equal(healthCount({ unrecorded, stillThere, clashes }), 5);
});
