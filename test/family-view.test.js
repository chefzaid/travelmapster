'use strict';

// Where the traveler is today in a trip's family view (public/js/family-view.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'family-view.js'));

const view = {
    startDate: '2027-05-01', days: 5,
    stops: [{ destination: 'Lisbon', firstDay: 0, days: 2 }, { destination: 'Madrid', firstDay: 2, days: 3 }]
};

test('a family sees whether the trip is ahead, under way and where, or over', async () => {
    const { whereNow } = await load();
    assert.deepEqual(whereNow(view, '2027-04-28'), { state: 'before', days: 3 });
    assert.deepEqual(whereNow(view, '2027-05-01'), { state: 'during', day: 1, stop: view.stops[0] });
    assert.deepEqual(whereNow(view, '2027-05-03'), { state: 'during', day: 3, stop: view.stops[1] });
    assert.deepEqual(whereNow(view, '2027-05-05'), { state: 'during', day: 5, stop: view.stops[1] });
    assert.deepEqual(whereNow(view, '2027-05-06'), { state: 'after' });
    assert.deepEqual(whereNow({ ...view, startDate: null }, '2027-05-01'), { state: 'undated' });
});
