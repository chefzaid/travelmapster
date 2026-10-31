'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('the account export needs a session', async () => {
    assert.equal((await createClient(ctx.server).get('/api/export')).status, 401);
});

test('the account export holds everything the account has, and only its own', async () => {
    const owner = createClient(ctx.server);
    await owner.register('exporter', 'exporter password');
    await owner.patch('/api/profile', { homeCountry: 'PRT', mapPalette: 'print' });
    const place = (await owner.post('/api/markers', { ...sampleMarker, hideFromPublic: true, tags: ['food'] })).body;
    await owner.post(`/api/markers/${place.id}/visits`, { startDate: '2025-02-01', endDate: '2025-02-03', notes: 'Second time' });
    await owner.post('/api/trips', { title: 'Porto', destination: 'Porto', startDate: '', plan: [{ morning: 'Ribeira' }] });
    await owner.put('/api/ledger', { dayRule: 'midnight', rules: [], planned: [] });

    const other = createClient(ctx.server);
    await other.register('someone_else', 'another password');
    await other.post('/api/markers', { ...sampleMarker, name: 'Rome, Italy' });

    const res = await owner.get('/api/export');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    const archive = res.body;
    assert.equal(archive.format, 'travelmapster-account');
    assert.equal(archive.version, 1);
    assert.ok(!Number.isNaN(Date.parse(archive.exportedAt)));
    assert.equal(archive.profile.username, 'exporter');
    assert.equal(archive.profile.homeCountry, 'PRT');
    assert.equal(archive.profile.mapPalette, 'print');
    assert.match(archive.profile.lastActiveDay, /^\d{4}-\d{2}-\d{2}$/, 'the last active day is the traveler\'s data too');
    assert.equal(archive.places.length, 1);
    assert.equal(archive.places[0].name, 'Paris, France');
    assert.equal(archive.places[0].hideFromPublic, true, 'hidden places are the owner\'s too');
    assert.deepEqual(archive.places[0].tags, ['food']);
    assert.deepEqual(archive.places[0].visits.map(visit => visit.startDate), ['2025-02-01', '2024-05-12']);
    assert.equal(archive.trips.length, 1);
    assert.equal(archive.trips[0].plan[0].morning, 'Ribeira');
    assert.deepEqual(archive.security, { passkeys: [], twoStep: false, activity: [] }, 'how the account signs in, without keys or secrets');
    assert.equal(archive.ledger.settings.dayRule, 'midnight');
    // Every change to visit dates, written by the database triggers.
    assert.equal(archive.ledger.changes.length, 2);
    assert.ok(!JSON.stringify(archive).includes('password'), 'no password hash');
    assert.ok(!JSON.stringify(archive).includes('Rome'), 'nothing of other accounts');
});

test('the export carries the whole date history, beyond what the ledger tab loads', async () => {
    const client = createClient(ctx.server);
    await client.register('long_history', 'history password');
    const place = (await client.post('/api/markers', { ...sampleMarker, travelDate: '' })).body;
    const userId = (await ctx.pool.query("SELECT id FROM users WHERE username = 'long_history'")).rows[0].id;
    // More rows than the ledger tab's limit of 5,000, inserted directly to keep the test fast.
    await ctx.pool.query(
        `INSERT INTO visit_changes (user_id, marker_id, visit_id, place_name, action, new_start_date)
         SELECT $1, $2, g, 'Paris, France', 'added', DATE '2020-01-01' + g FROM generate_series(1, 5001) g`,
        [userId, place.id]
    );
    assert.equal((await client.get('/api/ledger/changes')).body.length, 5000);
    assert.equal((await client.get('/api/export')).body.ledger.changes.length, 5001);
});
