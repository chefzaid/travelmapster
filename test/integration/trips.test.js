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

test('a trip keeps a packing list and a budget, and an update without them keeps them', async () => {
    const client = createClient(ctx.server);
    await client.register('packer', 'packer password');
    const packing = [{ item: ' Passport ', packed: true }, { item: 'Adapter', packed: 'yes' }];
    const budget = {
        currency: 'EUR',
        planned: 1200,
        rates: { JPY: 0.0061234567891, EUR: 2 },
        expenses: [
            { label: 'Flights', amount: 640.505, currency: 'EUR', category: 'transport' },
            { label: 'Ramen', amount: 1200, currency: 'JPY' }
        ]
    };
    const created = await client.post('/api/trips', { ...sampleTrip, packing, budget });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.packing, [{ item: 'Passport', packed: true }, { item: 'Adapter', packed: false }]);
    assert.deepEqual(created.body.budget, {
        currency: 'EUR',
        planned: 1200,
        rates: { JPY: 0.006123456789 },
        expenses: [
            { label: 'Flights', amount: 640.505, currency: 'EUR', category: 'transport' },
            { label: 'Ramen', amount: 1200, currency: 'JPY', category: 'other' }
        ]
    });

    // A tab from the previous release sends neither.
    const kept = await client.put(`/api/trips/${created.body.id}`, { ...sampleTrip, title: 'Tokyo' });
    assert.deepEqual(kept.body.packing, created.body.packing);
    assert.deepEqual(kept.body.budget, created.body.budget);

    const cleared = await client.put(`/api/trips/${created.body.id}`, { ...sampleTrip, packing: [], budget: {} });
    assert.deepEqual(cleared.body.packing, []);
    assert.deepEqual(cleared.body.budget, {});

    const plain = await client.post('/api/trips', sampleTrip);
    assert.deepEqual(plain.body.packing, []);
    assert.deepEqual(plain.body.budget, {});
});

test('invalid packing lists and budgets are rejected', async () => {
    const client = createClient(ctx.server);
    await client.register('badpacker', 'packer password');
    const expense = { label: 'Taxi', amount: 20, currency: 'EUR' };
    const cases = [
        { packing: 'socks' },
        { packing: Array(201).fill({ item: 'x' }) },
        { packing: [{ item: '' }] },
        { packing: ['socks'] },
        { packing: [{ item: 'x'.repeat(81) }] },
        { budget: [] },
        { budget: { currency: 'euro' } },
        { budget: { currency: 'EUR', planned: -1 } },
        { budget: { currency: 'EUR', planned: '100' } },
        { budget: { currency: 'EUR', rates: [] } },
        { budget: { currency: 'EUR', rates: { JPY: 0 } } },
        { budget: { currency: 'EUR', rates: { yen: 1 } } },
        { budget: { currency: 'EUR', expenses: {} } },
        { budget: { currency: 'EUR', expenses: Array(301).fill(expense) } },
        { budget: { currency: 'EUR', expenses: ['taxi'] } },
        { budget: { currency: 'EUR', expenses: [{ ...expense, label: '' }] } },
        { budget: { currency: 'EUR', expenses: [{ ...expense, amount: Number.NaN }] } },
        { budget: { currency: 'EUR', expenses: [{ ...expense, amount: 2e9 }] } },
        { budget: { currency: 'EUR', expenses: [{ ...expense, currency: 'eur' }] } },
        { budget: { currency: 'EUR', expenses: [{ ...expense, category: 'gifts' }] } }
    ];
    for (const override of cases) {
        const res = await client.post('/api/trips', { ...sampleTrip, ...override });
        assert.equal(res.status, 400, JSON.stringify(override).slice(0, 80));
    }
});

test('a trip keeps its stops, and an update without them keeps them', async () => {
    const client = createClient(ctx.server);
    await client.register('wanderer', 'wanderer password');
    const stops = [{ destination: ' Lisbon, Portugal ', days: 1 }, { destination: 'Madrid, Spain', days: 1 }];
    const created = await client.post('/api/trips', { ...sampleTrip, stops });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.stops, [{ destination: 'Lisbon, Portugal', days: 1 }, { destination: 'Madrid, Spain', days: 1 }]);
    const kept = await client.put(`/api/trips/${created.body.id}`, { ...sampleTrip, title: 'Iberia' });
    assert.deepEqual(kept.body.stops, created.body.stops, 'a tab from the previous release sends none');
    const single = await client.put(`/api/trips/${created.body.id}`, { ...sampleTrip, stops: [] });
    assert.deepEqual(single.body.stops, []);
    assert.deepEqual((await client.post('/api/trips', sampleTrip)).body.stops, []);

    const stop = { destination: 'Porto', days: 2 };
    for (const bad of [
        'Porto', [stop], Array(11).fill(stop), [stop, 'Porto'], [stop, { destination: '', days: 1 }],
        [stop, { destination: 'x'.repeat(161), days: 1 }], [stop, { destination: 'Faro', days: 0 }],
        [stop, { destination: 'Faro', days: 31 }], [stop, { destination: 'Faro', days: 1.5 }]
    ]) {
        const res = await client.post('/api/trips', { ...sampleTrip, stops: bad });
        assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 80));
    }
});
