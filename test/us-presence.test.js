'use strict';

// The US Substantial Presence Test (public/js/us-presence.js): this year's days, a third of last
// year's and a sixth of the year before's reach 183, with at least 31 this year.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const countryOf = marker => ({ id: marker.countryId });
const place = (id, countryId, startDate, endDate) => ({ id, countryId, name: `Place ${id}`, category: 'City', type: 'visited',
    visits: [{ id: id * 10, startDate, endDate }] });

test('the test weighs the last three years and needs 31 days this year', async () => {
    const { buildLedger } = await load('days.js');
    const { substantialPresence } = await load('us-presence.js');
    const at = (markers, today) => substantialPresence(buildLedger(markers, countryOf, { today }), today);
    // The IRS example: 120 days in each of three years makes 120 + 40 + 20 = 180, not met.
    const three = year => [year, year - 1, year - 2].map((y, i) => place(i + 1, 'USA', `${y}-05-01`, `${y}-08-28`));
    const close = at(three(2026), '2026-12-31');
    assert.deepEqual([close.current, close.last, close.before, close.total, close.status], [120, 120, 120, 180, 'warning']);
    const met = at([...three(2026), place(4, 'USA', '2026-10-01', '2026-10-03')], '2026-12-31');
    assert.deepEqual([met.current, met.total, met.status], [123, 183, 'reached']);
    // Counted up to today: a stay planned later this year does not count yet.
    assert.equal(at([place(1, 'USA', '2026-03-01', '2026-03-10')], '2026-03-05').current, 5);
    // A big total without 31 days this year is not met.
    const few = at([place(1, 'USA', '2025-01-01', '2025-12-31'), place(2, 'USA', '2024-01-01', '2024-12-31'), place(3, 'USA', '2026-01-01', '2026-01-30')], '2026-06-01');
    assert.equal(few.current, 30);
    assert.ok(few.total > 183);
    assert.equal(few.status, 'warning');
    assert.equal(at([place(1, 'FRA', '2026-01-01', '2026-01-30')], '2026-06-01'), null, 'no days in the United States');
    assert.equal(at([place(1, 'USA', '2020-01-01', '2020-01-30')], '2026-06-01'), null, 'none in the last three years');
});
