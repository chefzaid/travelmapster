// Unit tests for yearly goals (public/js/goals.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'goals.js'));

const place = (id, name, category, countryId, starts, fields = {}) => ({
    id, name, category, countryId, type: 'visited', stay: 'visit', visits: starts.map(startDate => ({ startDate })), ...fields
});
const countryOf = marker => ({ id: marker.countryId });

const markers = [
    place(1, 'Lisbon, Portugal', 'City', 'PRT', ['2025-03-01', '2027-05-01']),
    place(2, 'Porto, Portugal', 'City', 'PRT', ['2027-05-04']),
    place(3, 'Japan', 'Country', 'JPN', ['2027-10-01']),
    place(4, 'Kyoto, Japan', 'City', 'JPN', ['2027-10-03']),
    place(5, 'Doha, Qatar', 'City', 'QAT', ['2027-10-01'], { stay: 'transit' }),
    place(6, 'Spain', 'Country', 'ESP', ['2027-01-01'], { stay: 'lived' }),
    place(7, 'Peru', 'Country', 'PER', [], { type: 'wishlist' })
];

test('goals count new countries, new cities and trips in their year', async () => {
    const { goalProgress, goalLabel, goalKey } = await load();
    const goals = [
        { year: 2027, kind: 'countries', target: 3 },
        { year: 2027, kind: 'cities', target: 3 },
        { year: 2027, kind: 'visits', target: 10 },
        { year: 2026, kind: 'visits', target: 1 }
    ];
    const progress = goalProgress(goals, markers, { countryOf, countedIds: null });
    // Japan and Spain are new in 2027; Portugal was first visited in 2025; a layover is not a visit.
    assert.deepEqual(progress.map(({ count, percent, reached }) => [count, percent, reached]), [
        [2, 67, false], [2, 67, false], [5, 50, false], [0, 0, false]
    ]);
    assert.equal(goalLabel(goals[0]), '3 new countries in 2027');
    assert.equal(goalLabel({ year: 2028, kind: 'cities', target: 1 }), '1 new city in 2028');
    assert.equal(goalLabel({ year: 2028, kind: 'visits', target: 2 }), '2 trips in 2028');
    assert.equal(goalKey(goals[1]), '2027:cities');

    const reached = goalProgress([{ year: 2027, kind: 'countries', target: 2 }], markers, { countryOf, countedIds: null });
    assert.deepEqual(reached[0], { year: 2027, kind: 'countries', target: 2, count: 2, percent: 100, reached: true });
    // Counted on the chosen list only.
    assert.equal(goalProgress([{ year: 2027, kind: 'countries', target: 1 }], markers, { countryOf, countedIds: new Set(['JPN']) })[0].count, 1);
    assert.deepEqual(goalProgress(undefined, markers, { countryOf }), []);
});
