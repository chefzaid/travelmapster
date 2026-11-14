'use strict';

// Flight log: a traveler's flights, listed latest first, exported, private and checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('flights are added, listed latest first, exported and removed, each traveler only seeing their own', async () => {
    assert.equal((await createClient(ctx.server).get('/api/flights')).status, 401);
    const client = createClient(ctx.server);
    await client.register('flyer', 'flyer password');
    const out = await client.post('/api/flights', { date: '2027-05-01', from: 'lis', to: 'KIX', number: 'tp 1352' });
    assert.equal(out.status, 201);
    assert.deepEqual({ ...out.body, id: 0 }, { id: 0, date: '2027-05-01', from: 'LIS', to: 'KIX', number: 'TP 1352' });
    await client.post('/api/flights', { date: '2027-05-20', from: 'KIX', to: 'LIS' });
    const list = (await client.get('/api/flights')).body;
    assert.deepEqual(list.map(flight => flight.date), ['2027-05-20', '2027-05-01']);
    assert.equal(list[0].number, null);
    assert.equal((await client.get('/api/export')).body.flights.length, 2);

    const other = createClient(ctx.server);
    await other.register('grounded', 'grounded password');
    assert.deepEqual((await other.get('/api/flights')).body, []);
    assert.equal((await other.delete(`/api/flights/${out.body.id}`)).status, 404);

    for (const bad of [{}, { date: '2027-05-01', from: 'LIS', to: 'LIS' }, { date: '2027-13-01', from: 'LIS', to: 'KIX' }, { date: '2027-05-01', from: 'LI', to: 'KIX' }]) {
        assert.equal((await client.post('/api/flights', bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await client.delete(`/api/flights/${out.body.id}`)).status, 204);
    assert.equal((await client.delete(`/api/flights/${out.body.id}`)).status, 404);
    assert.equal((await client.delete('/api/flights/nope')).status, 404);
    assert.equal((await client.get('/api/flights')).body.length, 1);
});

test('a flight log holds at most 2,000 flights', async () => {
    const client = createClient(ctx.server);
    const { body } = await client.register('frequent_flyer', 'frequent flyer password');
    await ctx.pool.query(
        `INSERT INTO flights (user_id, flown_on, origin, destination)
         SELECT $1, DATE '2020-01-01' + n % 1000, 'LIS', 'OPO' FROM generate_series(1, 2000) AS n`,
        [body.user.id]
    );
    assert.equal((await client.post('/api/flights', { date: '2027-05-01', from: 'LIS', to: 'KIX' })).status, 409);
});
