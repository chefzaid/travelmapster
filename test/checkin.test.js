'use strict';

// "I'm here" (public/js/visits.js): checking in adds today, extends yesterday's visit, or does
// nothing when today is already recorded.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'visits.js'));

test('checking in records today once', async () => {
    const { checkInPlan } = await load();
    const today = '2026-03-01';
    assert.deepEqual(checkInPlan([], today), { action: 'add', visit: { startDate: today, endDate: today, notes: '', photoUrl: '', ongoing: false } });
    assert.equal(checkInPlan([{ id: 1, startDate: '2026-02-20', ongoing: true }], today).action, 'none', 'still there');
    assert.equal(checkInPlan([{ id: 1, startDate: '2026-02-27', endDate: '2026-03-04' }], today).action, 'none', 'already covers today');
    assert.equal(checkInPlan([{ id: 1, startDate: today }], today).action, 'none', 'a visit today without an end');
    assert.deepEqual(checkInPlan([{ id: 1, startDate: '2026-02-25', endDate: '2026-02-28', notes: 'hi', photoUrl: '' }], today),
        { action: 'extend', visit: { id: 1, startDate: '2026-02-25', endDate: today, notes: 'hi', photoUrl: '', ongoing: false } }, 'across the end of February');
    assert.equal(checkInPlan([{ id: 1, startDate: '2026-02-28' }], today).action, 'extend', 'a one-day visit yesterday');
    assert.equal(checkInPlan([{ id: 1, startDate: '2026-02-01', endDate: '2026-02-10' }], today).action, 'add');
    assert.equal(checkInPlan([{ id: 1, startDate: '2026-03-05', endDate: '2026-03-08' }], today).action, 'add', 'a visit planned later');
});
