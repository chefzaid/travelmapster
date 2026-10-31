'use strict';

// Places saved twice (public/js/duplicates.js): the same name, or two town pins a short walk apart.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'duplicates.js'));
const place = (id, name, lat, lng, category = 'City', visits = 0) => ({ id, name, lat, lng, category, visits: Array.from({ length: visits }, (_, i) => ({ id: i })) });

test('duplicates pair the same name or two nearby town pins, keeping the place with more visits', async () => {
    const { findDuplicates } = await load();
    const pairs = findDuplicates([
        place(1, 'Lisbon, Portugal', 38.72, -9.14, 'City', 1),
        place(2, 'Lisboa, Portugal', 38.725, -9.15, 'City', 3),
        place(3, 'Porto, Portugal', 41.15, -8.61),
        place(4, 'Japan', 36.5, 138, 'Country'),
        place(5, 'japan', 35, 135, 'Country', 2),
        place(6, 'Japan', 35.7, 139.7, 'City'),
        place(7, 'São Paulo, Brazil', -23.55, -46.63),
        place(8, 'Sao Paulo, Brazil', -23.6, -46.7)
    ]);
    assert.deepEqual(pairs.map(({ keep, other }) => [keep.id, other.id]), [[2, 1], [5, 4], [7, 8]]);
    assert.deepEqual(findDuplicates([place(1, 'Paris, France', 48.85, 2.35), place(2, 'Lyon, France', 45.76, 4.84)]), []);
});
