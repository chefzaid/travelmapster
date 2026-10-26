// Unit tests for "On this day" memories (public/js/memories.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'memories.js'));

const place = (id, name, startDates, fields = {}) => ({
    id, name, type: 'visited', stay: 'visit', visits: startDates.map(startDate => ({ startDate })), ...fields
});

test('memories are visits that began on this day in an earlier year, most recent first', async () => {
    const { onThisDay, memoryLabel } = await load();
    const markers = [
        place(1, 'Lisbon, Portugal', ['2021-06-14', '2024-06-14', '2024-06-15']),
        place(2, 'Japan', ['2025-06-14']),
        place(3, 'Berlin, Germany', ['2026-06-14']),
        place(4, 'Peru', ['2019-06-14'], { type: 'wishlist' }),
        place(5, 'Doha, Qatar', ['2023-06-14'], { stay: 'transit' }),
        place(6, 'Spain', ['2020-06-14'], { stay: 'lived' }),
        { id: 7, name: 'Chile', type: 'visited' }
    ];
    const memories = onThisDay(markers, '2026-06-14');
    assert.deepEqual(memories.map(({ marker, yearsAgo }) => [marker.name, yearsAgo]), [
        ['Japan', 1], ['Lisbon, Portugal', 2], ['Lisbon, Portugal', 5], ['Spain', 6]
    ]);
    assert.equal(memoryLabel(memories[0]), 'A year ago today, you arrived in Japan');
    assert.equal(memoryLabel(memories[1]), '2 years ago today, you arrived in Lisbon');
    assert.equal(memoryLabel(memories[3]), '6 years ago today, you moved to Spain');
    assert.deepEqual(onThisDay(markers, '2026-06-13'), []);
    assert.deepEqual(onThisDay([], '2026-06-14'), []);
});

test('a visit that began on a leap day comes back on 28 February in other years', async () => {
    const { onThisDay } = await load();
    const markers = [place(1, 'Iceland', ['2024-02-29']), place(2, 'Norway', ['2023-02-28'])];
    assert.deepEqual(onThisDay(markers, '2027-02-28').map(memory => memory.marker.name), ['Iceland', 'Norway']);
    assert.deepEqual(onThisDay(markers, '2028-02-28').map(memory => memory.marker.name), ['Norway']);
    assert.deepEqual(onThisDay(markers, '2028-02-29').map(memory => memory.marker.name), ['Iceland']);
});
