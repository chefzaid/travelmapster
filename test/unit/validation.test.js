'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isSingleEmoji, isValidTravelDate, normalizeTag, parseCredentials, parseLedgerSettings, parseMarkerId, parseMarkerPayload, parseProfileVisibility,
    parseVisitPayload
} = require('../../src/validation');

const valid = { lat: '10.5', lng: -20, type: 'visited', name: ' Rome ', category: 'City' };

test('parseMarkerPayload normalizes a valid marker', () => {
    const { marker, error } = parseMarkerPayload(valid);
    assert.equal(error, undefined);
    assert.deepEqual(marker, {
        lat: 10.5, lng: -20, type: 'visited', name: 'Rome', category: 'City',
        photoUrl: null, notes: null, travelDate: undefined
    });
    assert.equal(parseMarkerPayload({ ...valid, travelDate: '' }).marker.travelDate, null, 'an empty date is sent on purpose');
});

test('parseMarkerPayload reads place details only when they are sent', () => {
    const { marker } = parseMarkerPayload({ ...valid, rating: 3, tags: ['Food', 'food', ' Road   Trip '], emoji: '🍜' });
    assert.deepEqual([marker.rating, marker.tags, marker.emoji], [3, ['food', 'road trip'], '🍜']);
    const cleared = parseMarkerPayload({ ...valid, rating: '', tags: null, emoji: null }).marker;
    assert.deepEqual([cleared.rating, cleared.tags, cleared.emoji], [null, [], null]);
    assert.equal(normalizeTag(42), '');
    for (const emoji of ['😀', '🇫🇷', '👨‍👩‍👧‍👦', '1️⃣', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '👍🏽']) assert.ok(isSingleEmoji(emoji), emoji);
    for (const text of ['a', '1', '#', '😀😀', '🇫', 'x😀', ' ', '😀'.repeat(17)]) assert.ok(!isSingleEmoji(text), text);
});

test('parseMarkerPayload reads visits only when asked to', () => {
    const body = { ...valid, visits: [{ startDate: '2024-01-01', endDate: '2024-01-02' }] };
    assert.equal(parseMarkerPayload(body).marker.visits, undefined);
    assert.deepEqual(parseMarkerPayload(body, { withVisits: true }).marker.visits, [
        { startDate: '2024-01-01', endDate: '2024-01-02', ongoing: false, notes: null, photoUrl: null }
    ]);
    assert.equal(parseMarkerPayload({ ...valid, visits: null }, { withVisits: true }).marker.visits, undefined);
    assert.match(parseMarkerPayload({ ...valid, visits: [{}] }, { withVisits: true }).error, /^Visit 1: /);
});

test('parseVisitPayload keeps plain calendar dates in order', () => {
    assert.deepEqual(parseVisitPayload({ startDate: ' 2024-02-29 ', notes: ' Leap day ', photoUrl: 'http://e.com/x.jpg' }).visit, {
        startDate: '2024-02-29', endDate: null, ongoing: false, notes: 'Leap day', photoUrl: 'http://e.com/x.jpg'
    });
    assert.equal(parseVisitPayload({ startDate: '2024-03-01', endDate: '2024-03-01' }).visit.endDate, '2024-03-01', 'a one-day visit');
    for (const bad of [null, [], { startDate: '2023-02-29' }, { startDate: '2024-03-02', endDate: '2024-03-01' }]) {
        assert.ok(parseVisitPayload(bad).error, JSON.stringify(bad));
    }
});

test('parseMarkerPayload rejects non-objects and bad fields', () => {
    assert.ok(parseMarkerPayload(null).error);
    assert.ok(parseMarkerPayload({ ...valid, lat: 'abc' }).error);
    assert.ok(parseMarkerPayload({ ...valid, lng: ' ' }).error);
    assert.ok(parseMarkerPayload({ ...valid, photoUrl: 'ftp://example.com/x' }).error);
    assert.ok(parseMarkerPayload({ ...valid, photoUrl: `https://e.com/${'a'.repeat(2048)}` }).error);
});

test('isValidTravelDate checks real calendar dates', () => {
    assert.equal(isValidTravelDate('2024-02-29'), true);
    assert.equal(isValidTravelDate('2023-02-29'), false);
    assert.equal(isValidTravelDate('2024-13-01'), false);
    assert.equal(isValidTravelDate('24-01-01'), false);
});

test('parseCredentials keeps password whitespace and trims usernames', () => {
    const { credentials } = parseCredentials({ username: ' user_1 ', password: '  spaced password ' });
    assert.deepEqual(credentials, { username: 'user_1', password: '  spaced password ' });
    assert.ok(parseCredentials({}).error);
    assert.ok(parseCredentials({ username: 'user', password: 'é'.repeat(40) }).error, '80 bytes exceeds bcrypt limit');
});

test('parseMarkerId accepts positive integers only', () => {
    assert.equal(parseMarkerId('42'), 42);
    for (const bad of ['0', '-1', '1.5', 'abc', '1e3', '9999999999999999']) {
        assert.equal(parseMarkerId(bad), null, bad);
    }
});

test('parseProfileVisibility accepts only private or public', () => {
    assert.deepEqual(parseProfileVisibility({ profileVisibility: 'public' }), { profileVisibility: 'public' });
    assert.ok(parseProfileVisibility({ profileVisibility: 'friends' }).error);
});

test('parseVisitPayload keeps a stay still going on only without an end date', () => {
    assert.equal(parseVisitPayload({ startDate: '2026-10-01', ongoing: true }).visit.ongoing, true);
    assert.ok(parseVisitPayload({ startDate: '2026-10-01', endDate: '2026-10-02', ongoing: true }).error);
    assert.ok(parseVisitPayload({ startDate: '2026-10-01', ongoing: 'true' }).error);
    assert.equal(parseVisitPayload({ startDate: '2026-10-01', ongoing: null }).visit.ongoing, false);
});

test('parseLedgerSettings keeps only known rule fields and defaults missing lists', () => {
    const { settings } = parseLedgerSettings({
        dayRule: 'midnight',
        rules: [{ id: 'a', kind: 'threshold', name: ' Rolling ', countries: ['ESP', 'ESP'], maxDays: 10, period: 'rolling', windowDays: 30, warnDays: 2, yearStart: '01-01' }]
    });
    assert.deepEqual(settings, {
        dayRule: 'midnight',
        rules: [{ id: 'a', kind: 'threshold', name: 'Rolling', countries: ['ESP'], maxDays: 10, period: 'rolling', windowDays: 30, warnDays: 2 }],
        planned: []
    });
    assert.ok(parseLedgerSettings(null).error);
    assert.ok(parseLedgerSettings({ dayRule: 'presence', planned: [{ id: 'p', countryId: 'FRA', startDate: '2026-01-01' }] }).error);
});
