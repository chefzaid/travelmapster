'use strict';

// Import and export of saved places (public/js/io.js): JSON and CSV round trips, every field and
// visit, and older files.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

test('import and export round-trip saved places', async () => {
    const { buildCsv, parseImportContent, validatePlace, placeKey } = await load('io.js');
    const markers = [
        { id: 1, lat: 48.86, lng: 2.35, type: 'visited', name: 'Paris, "City of Light"', category: 'City', photoUrl: '', notes: 'Line one\nline two', travelDate: '2024-01-02' }
    ];
    const [record] = parseImportContent('places.csv', buildCsv(markers));
    const place = validatePlace(record);
    assert.equal(place.name, 'Paris, "City of Light"');
    assert.equal(place.notes, 'Line one\nline two');
    assert.equal(place.travelDate, '2024-01-02');
    assert.equal(placeKey(place), placeKey(markers[0]));

    assert.deepEqual(place.visits, [{ startDate: '2024-01-02', endDate: '', notes: '', photoUrl: '', ongoing: false }],
        'an export from before visits turns its travel date into a visit');

    assert.equal(validatePlace({ ...record, photoUrl: 'javascript:alert(1)' }), null);
    assert.equal(validatePlace({ ...record, visitStartDate: '', travelDate: '2024-02-30' }), null);
    assert.equal(validatePlace({ ...record, lat: 120 }), null);
    assert.equal(parseImportContent('places.json', JSON.stringify({ markers: [record] })).length, 1);
    assert.throws(() => parseImportContent('places.txt', ''), /json or \.csv/);
    assert.throws(() => parseImportContent('places.csv', 'name\nParis'), /must include/);
});

test('import and export round-trip every visit in JSON and CSV', async () => {
    const { buildCsv, buildJson, parseImportContent, validatePlace, mergePlaces } = await load('io.js');
    const markers = [
        {
            id: 1, lat: 38.72, lng: -9.14, type: 'visited', name: 'Lisbon, Portugal', category: 'City', photoUrl: '', notes: 'Trams',
            travelDate: '2023-04-01',
            visits: [
                { id: 5, startDate: '2019-06-01', endDate: '2019-06-04', notes: 'First, "sunny"', photoUrl: 'https://example.com/1.jpg' },
                { id: 9, startDate: '2023-04-01', endDate: '', notes: '', photoUrl: '', ongoing: true }
            ]
        },
        { id: 2, lat: 35.68, lng: 139.69, type: 'wishlist', name: 'Japan', category: 'Country', photoUrl: '', notes: '', travelDate: '', visits: [] }
    ];
    const expected = [
        { startDate: '2023-04-01', endDate: '', notes: '', photoUrl: '', ongoing: true },
        { startDate: '2019-06-01', endDate: '2019-06-04', notes: 'First, "sunny"', photoUrl: 'https://example.com/1.jpg', ongoing: false }
    ];

    const fromJson = parseImportContent('places.json', buildJson(markers)).map(validatePlace);
    assert.deepEqual(fromJson[0].visits, expected);
    assert.equal(fromJson[0].travelDate, '2023-04-01');
    assert.deepEqual(fromJson[1].visits, []);

    const csv = buildCsv(markers);
    assert.equal(csv.split('\r\n').length, 4, 'a header, one row per visit and one for the place without visits');
    const rows = parseImportContent('places.csv', csv).map(validatePlace);
    assert.equal(rows.length, 3);
    const merged = mergePlaces(rows);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0].visits, expected);
    assert.equal(merged[0].notes, 'Trams');
    assert.deepEqual(merged[1].visits, []);

    // The same visit listed twice is kept once; a bad visit rejects only its row.
    assert.equal(mergePlaces([...rows, rows[0]])[0].visits.length, 2);
    const [record] = parseImportContent('places.csv', csv);
    assert.equal(validatePlace({ ...record, visitEndDate: '2000-01-01' }), null);
    assert.equal(validatePlace({ ...JSON.parse(buildJson(markers))[0], visits: [{ startDate: 'soon' }] }), null);
});

test('import and export round-trip ratings, tags, emoji and hidden places, and read older files', async () => {
    const { buildCsv, buildJson, parseImportContent, validatePlace, mergePlaces } = await load('io.js');
    const markers = [{
        id: 1, lat: 41.9, lng: 12.5, type: 'visited', name: 'Rome, Italy', category: 'City', photoUrl: '', notes: '',
        rating: 5, tags: ['food', 'street art'], emoji: '🍝', hideFromPublic: true,
        visits: [{ startDate: '2022-02-02' }, { startDate: '2023-03-03' }]
    }];
    for (const [file, content] of [['places.json', buildJson(markers)], ['places.csv', buildCsv(markers)]]) {
        const [place] = mergePlaces(parseImportContent(file, content).map(validatePlace));
        assert.deepEqual([place.rating, place.tags, place.emoji, place.hideFromPublic, place.visits.length],
            [5, ['food', 'street art'], '🍝', true, 2], file);
    }
    assert.match(buildCsv(markers), /"food; street art"/);
    const old = 'lat,lng,type,name,category,notes,travelDate\n41.9,12.5,visited,Rome,City,,2020-01-01';
    const [place] = parseImportContent('old.csv', old).map(validatePlace);
    assert.deepEqual([place.rating, place.tags, place.emoji, place.hideFromPublic], [null, [], '', false]);
    assert.equal(validatePlace({ ...JSON.parse(buildJson(markers))[0], emoji: 'pizza' }), null, 'an invalid detail skips the row');
});

test('import and export keep whether a place was lived in or passed through', async () => {
    const io = await load('io.js');
    const markers = [
        { id: 1, lat: 52.52, lng: 13.4, type: 'visited', stay: 'lived', name: 'Berlin, Germany', category: 'City', visits: [{ startDate: '2015-09-01', endDate: '2019-06-30' }] },
        { id: 2, lat: 25.2, lng: 55.27, type: 'visited', stay: 'transit', name: 'Dubai, United Arab Emirates', category: 'City', visits: [] },
        { id: 3, lat: 46, lng: 2, type: 'wishlist', name: 'France', category: 'Country', visits: [] }
    ];
    const fromJson = JSON.parse(io.buildJson(markers)).map(io.validatePlace);
    assert.deepEqual(fromJson.map(place => place.stay), ['lived', 'transit', 'visit']);
    const fromCsv = io.mergePlaces(io.parseCsv(io.buildCsv(markers)).map(io.validatePlace));
    assert.deepEqual(fromCsv.map(place => [place.name, place.stay]), markers.map(marker => [marker.name, marker.stay || 'visit']));
    assert.equal(io.validatePlace({ ...markers[0], stay: 'LIVED' }).stay, 'lived');
    assert.equal(io.validatePlace({ ...markers[0], stay: undefined }).stay, 'visit', 'older files are plain visits');
    assert.equal(io.validatePlace({ ...markers[0], stay: 'home' }), null);
    assert.equal(io.validatePlace({ ...markers[2], stay: 'transit' }), null, 'a wish is never a layover');
});
