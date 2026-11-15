'use strict';

// Pasted flights (public/js/flight-paste.js): free lines and apps' CSV exports, checked, with
// what was already logged and what was not understood.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'flight-paste.js'));

test('lines give a date, two airport codes and a flight number, in any order', async () => {
    const { readPastedFlights } = await load();
    const result = readPastedFlights('2026-05-01 LIS KIX TP1352\n  lis-opo 2025-08-02  \n\nhello world\n2026-05-20 via KIX and LIS\n2026-05-21 KIX KIX', [{ date: '2026-05-20', from: 'KIX', to: 'LIS' }]);
    assert.deepEqual(result.flights, [
        { date: '2026-05-01', from: 'LIS', to: 'KIX', number: 'TP1352' },
        { date: '2025-08-02', from: 'LIS', to: 'OPO', number: null }
    ]);
    assert.deepEqual(result.skipped, ['hello world', '2026-05-21 KIX KIX']);
    assert.equal(result.known, 1);
    assert.equal(result.tooMany, 0);
    assert.equal(readPastedFlights('2026-05-01 LIS KIX\n2026-05-01 LIS KIX').flights.length, 1, 'one flight once');
});

test('a CSV export is read by its column names, airport cells such as "Lisbon (LIS)" included', async () => {
    const { readPastedFlights } = await load();
    const csv = '﻿Date,Airline,Flight,Departure Airport,Arrival Airport\n2026-05-01,TAP,TP 1352,Lisbon (LIS),Osaka (KIX)\n2026-05-02T10:00,TAP,TP9,LIS,OPO\n,,,,\nbad,x,y,z,w';
    const { flights, skipped } = readPastedFlights(csv);
    assert.deepEqual(flights, [{ date: '2026-05-01', from: 'LIS', to: 'KIX', number: 'TP 1352' }, { date: '2026-05-02', from: 'LIS', to: 'OPO', number: 'TP9' }]);
    assert.deepEqual(skipped, ['bad, x, y, z, w']);
    // A CSV without the columns, or a broken one, is read as lines.
    assert.equal(readPastedFlights('Name,Code\n2026-05-01 LIS KIX,x').flights.length, 1);
    assert.equal(readPastedFlights('"open quote 2026-05-01 LIS KIX').flights.length, 1);
});

test('at most 500 flights are taken at once', async () => {
    const { readPastedFlights, PASTE_MAX } = await load();
    const lines = Array.from({ length: PASTE_MAX + 3 }, (_, i) => `2020-01-01 LIS ${String.fromCharCode(65 + Math.floor(i / 676) % 26)}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + i % 26)}`).join('\n');
    const { flights, tooMany } = readPastedFlights(lines);
    assert.equal(flights.length, PASTE_MAX);
    assert.equal(tooMany, 3);
});

test('a guest\'s pasted flights fill the log only as far as it has room', async () => {
    const { createGuestApi } = await import(path.join(__dirname, '..', 'public', 'js', 'guest-api.js'));
    const store = new Map();
    const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
    const api = createGuestApi(storage, () => '2026-10-26T10:00:00.000Z');
    const { flights, full } = await api.importFlights([{ date: '2026-05-01', from: 'LIS', to: 'KIX', number: null }, { date: '2026-05-20', from: 'KIX', to: 'LIS' }]);
    assert.deepEqual(flights.map(flight => flight.number), [null, null]);
    assert.equal(full, false);
    assert.equal((await api.getFlights()).length, 2);
});
