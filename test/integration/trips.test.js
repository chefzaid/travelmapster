'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const sampleTrip = Object.freeze({
    title: 'Lisbon long weekend',
    destination: 'Lisbon, Portugal',
    startDate: '2025-04-18',
    plan: [
        { morning: 'Belém tower', afternoon: 'Tram 28', evening: 'Fado in Alfama' },
        { morning: ' Sintra ', afternoon: '', evening: 'Seafood', extra: 'ignored' }
    ]
});

test('trip routes require authentication', async () => {
    const client = createClient(ctx.server);
    assert.equal((await client.get('/api/trips')).status, 401);
    assert.equal((await client.post('/api/trips', sampleTrip)).status, 401);
});

test('create, list, update and delete a trip', async () => {
    const client = createClient(ctx.server);
    await client.register('planner', 'planner password');

    const created = await client.post('/api/trips', sampleTrip);
    assert.equal(created.status, 201);
    assert.equal(created.body.title, sampleTrip.title);
    assert.equal(created.body.startDate, '2025-04-18');
    assert.deepEqual(created.body.plan[1], { morning: 'Sintra', afternoon: '', evening: 'Seafood' });
    assert.ok(created.body.createdAt);

    const second = await client.post('/api/trips', { ...sampleTrip, title: 'Someday', startDate: '' });
    assert.equal(second.body.startDate, '');

    const list = await client.get('/api/trips');
    assert.equal(list.body.length, 2);

    const updated = await client.put(`/api/trips/${created.body.id}`, { ...sampleTrip, title: 'Lisbon and Porto' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.title, 'Lisbon and Porto');

    assert.equal((await client.delete(`/api/trips/${created.body.id}`)).status, 204);
    assert.equal((await client.delete(`/api/trips/${created.body.id}`)).status, 404);
    assert.equal((await client.put(`/api/trips/${created.body.id}`, sampleTrip)).status, 404);
    assert.equal((await client.get('/api/trips')).body.length, 1);
});

test('invalid trips are rejected', async () => {
    const client = createClient(ctx.server);
    await client.register('badplanner', 'planner password');
    const cases = [
        { title: '' },
        { title: 'x'.repeat(121) },
        { destination: '' },
        { startDate: '2025-02-30' },
        { plan: [] },
        { plan: Array(31).fill({ morning: 'x' }) },
        { plan: ['not an object'] },
        { plan: [{ morning: 'x'.repeat(501) }] }
    ];
    for (const override of cases) {
        const res = await client.post('/api/trips', { ...sampleTrip, ...override });
        assert.equal(res.status, 400, JSON.stringify(override).slice(0, 80));
    }
    assert.equal((await client.put('/api/trips/abc', sampleTrip)).status, 400);
});

test('users cannot touch each other\'s trips', async () => {
    const owner = createClient(ctx.server);
    await owner.register('tripowner', 'owner password');
    const { body: trip } = await owner.post('/api/trips', sampleTrip);

    const other = createClient(ctx.server);
    await other.register('tripthief', 'thief password');
    assert.deepEqual((await other.get('/api/trips')).body, []);
    assert.equal((await other.put(`/api/trips/${trip.id}`, sampleTrip)).status, 404);
    assert.equal((await other.delete(`/api/trips/${trip.id}`)).status, 404);
});
