'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isValidTravelDate, parseCredentials, parseMarkerId, parseMarkerPayload, parseProfileVisibility
} = require('../../src/validation');

const valid = { lat: '10.5', lng: -20, type: 'visited', name: ' Rome ', category: 'City' };

test('parseMarkerPayload normalizes a valid marker', () => {
    const { marker, error } = parseMarkerPayload(valid);
    assert.equal(error, undefined);
    assert.deepEqual(marker, {
        lat: 10.5, lng: -20, type: 'visited', name: 'Rome', category: 'City',
        photoUrl: null, notes: null, travelDate: null
    });
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
