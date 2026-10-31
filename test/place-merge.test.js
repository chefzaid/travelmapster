'use strict';

// Merging two places (public/js/place-merge.js): what the kept place takes from the other.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'place-merge.js'));

const place = fields => ({ lat: 1, lng: 2, name: 'Paris, France', category: 'City', type: 'visited', stay: 'visit', notes: '', photoUrl: null,
    rating: null, tags: [], emoji: null, hideFromPublic: false, priority: null, bestMonths: [], ...fields });

test('the kept place keeps its own details and takes those it lacks', async () => {
    const { mergedDetails } = await load();
    const merged = mergedDetails(place({ notes: 'A', tags: ['a', 'b'], rating: 3, emoji: '🥐' }),
        place({ lat: 9, notes: 'B', tags: ['b', 'c'], rating: 5, emoji: '🗼', photoUrl: 'https://x.test/p.jpg', stay: 'lived' }));
    assert.deepEqual(merged, place({ notes: 'A\n\nB', tags: ['a', 'b', 'c'], rating: 3, emoji: '🥐', photoUrl: 'https://x.test/p.jpg' }));
});

test('a place been to wins over a wish, privacy wins, and limits hold', async () => {
    const { mergedDetails } = await load();
    const merged = mergedDetails(place({ type: 'wishlist', priority: 'soon', bestMonths: [5] }),
        place({ stay: 'lived', hideFromPublic: true, notes: 'x'.repeat(1990), tags: ['1', '2', '3', '4', '5', '6', '7', '8'] }));
    assert.equal(merged.type, 'visited');
    assert.equal(merged.stay, 'lived');
    assert.equal(merged.hideFromPublic, true);
    assert.equal(merged.notes.length, 1990);
    assert.equal(merged.tags.length, 8);
    assert.equal(merged.priority, 'soon');
    assert.deepEqual(mergedDetails(place({ notes: 'same' }), place({ notes: ' same ' })).notes, 'same', 'the same note once');
    assert.equal(mergedDetails(place({ type: 'visited', stay: 'transit' }), place({ type: 'wishlist' })).stay, 'transit');
});
