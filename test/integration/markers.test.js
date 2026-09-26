'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('marker routes require authentication', async () => {
    const client = createClient(ctx.server);
    assert.equal((await client.get('/api/markers')).status, 401);
    assert.equal((await client.post('/api/markers', sampleMarker)).status, 401);
    assert.equal((await client.patch('/api/markers/1', sampleMarker)).status, 401);
    assert.equal((await client.delete('/api/markers/1')).status, 401);
});

test('create, list, update and delete a marker', async () => {
    const client = createClient(ctx.server);
    await client.register('mapper', 'mapper password');

    const created = await client.post('/api/markers', sampleMarker);
    assert.equal(created.status, 201);
    assert.equal(typeof created.body.id, 'number');
    assert.deepEqual({ ...created.body, id: undefined }, { ...sampleMarker, id: undefined });

    const list = await client.get('/api/markers');
    assert.deepEqual(list.body, [created.body]);

    const updated = await client.patch(`/api/markers/${created.body.id}`, {
        ...sampleMarker, type: 'wishlist', notes: '', photoUrl: '', travelDate: ''
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.type, 'wishlist');
    assert.equal(updated.body.notes, null);
    assert.equal(updated.body.photoUrl, null);
    assert.equal(updated.body.travelDate, null);

    assert.equal((await client.delete(`/api/markers/${created.body.id}`)).status, 204);
    assert.equal((await client.delete(`/api/markers/${created.body.id}`)).status, 404);
    assert.deepEqual((await client.get('/api/markers')).body, []);
});

test('invalid marker payloads are rejected', async () => {
    const client = createClient(ctx.server);
    await client.register('validator', 'validator password');
    const cases = [
        { lat: 91 },
        { lng: -181 },
        { lat: '' },
        { type: 'maybe' },
        { category: 'Planet' },
        { name: '   ' },
        { name: 'x'.repeat(201) },
        { notes: 'x'.repeat(2001) },
        { travelDate: '2024-02-30' },
        { photoUrl: 'javascript:alert(1)' },
        { photoUrl: 'not a url' }
    ];
    for (const override of cases) {
        const res = await client.post('/api/markers', { ...sampleMarker, ...override });
        assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(override)}`);
        assert.ok(res.body.error);
    }
    assert.equal((await client.patch('/api/markers/abc', sampleMarker)).status, 400);
    assert.equal((await client.delete('/api/markers/0')).status, 400);
});

test('users can never read or change each other\'s markers', async () => {
    const owner = createClient(ctx.server);
    await owner.register('owner', 'owner password');
    const { body: marker } = await owner.post('/api/markers', sampleMarker);

    const intruder = createClient(ctx.server);
    await intruder.register('intruder', 'intruder password');
    assert.deepEqual((await intruder.get('/api/markers')).body, []);
    assert.equal((await intruder.patch(`/api/markers/${marker.id}`, sampleMarker)).status, 404);
    assert.equal((await intruder.delete(`/api/markers/${marker.id}`)).status, 404);
    assert.equal((await owner.get('/api/markers')).body.length, 1);
});

test('bulk import stores valid places and reports skipped ones', async () => {
    const client = createClient(ctx.server);
    await client.register('importer', 'importer password');
    const res = await client.post('/api/markers/import', {
        markers: [sampleMarker, { ...sampleMarker, name: 'Lyon, France' }, { ...sampleMarker, lat: 500 }]
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.imported, 2);
    assert.equal(res.body.skipped, 1);
    assert.equal(res.body.errors[0].index, 2);
    assert.equal((await client.get('/api/markers')).body.length, 2);

    assert.equal((await client.post('/api/markers/import', { markers: 'nope' })).status, 400);
    const tooMany = await client.post('/api/markers/import', { markers: Array(1001).fill(sampleMarker) });
    assert.equal(tooMany.status, 413);
});

test('deleting a user cascades to their markers', async () => {
    const client = createClient(ctx.server);
    const { body } = await client.register('leaver', 'leaver password');
    await client.post('/api/markers', sampleMarker);
    await ctx.pool.query('DELETE FROM users WHERE id = $1', [body.user.id]);
    const { rows } = await ctx.pool.query('SELECT count(*)::int AS count FROM markers WHERE user_id = $1', [body.user.id]);
    assert.equal(rows[0].count, 0);
    assert.equal((await client.get('/api/auth/me')).status, 401, 'stale sessions are logged out');
});
