'use strict';

// Firsts (public/js/firsts.js): the first visit to each continent, and its country.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'firsts.js'));
const portugal = { name: 'Portugal', continent: 'Europe' };
const spain = { name: 'Spain', continent: 'Europe' };
const japan = { name: 'Japan', continent: 'Asia' };

test('each continent shows its first visit, the earliest first, from places been to', async () => {
    const { continentFirsts } = await load();
    const markers = [
        { id: 1, type: 'visited', visits: [{ startDate: '2015-06-01' }, { startDate: '2009-04-02' }] },
        { id: 2, type: 'visited', visits: [{ startDate: '2009-04-02' }] },
        { id: 3, type: 'visited', stay: 'transit', visits: [{ startDate: '2012-01-01' }] },
        { id: 4, type: 'wishlist', visits: [{ startDate: '2001-01-01' }] },
        { id: 5, type: 'visited', visits: [] },
        { id: 6, type: 'visited', visits: [{ startDate: '2000-01-01' }] }
    ];
    const countries = { 1: spain, 2: portugal, 3: japan, 4: japan, 5: japan };
    const firsts = continentFirsts(markers, marker => countries[marker.id]);
    assert.deepEqual(firsts, [
        { continent: 'Europe', date: '2009-04-02', country: portugal },
        { continent: 'Asia', date: '2012-01-01', country: japan }
    ]);
    assert.deepEqual(continentFirsts([], () => null), []);
});
