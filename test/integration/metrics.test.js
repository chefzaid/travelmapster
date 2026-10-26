'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

async function funnel() {
    const metric = await ctx.metrics.registry.getSingleMetric('travelmapster_funnel_total').get();
    return Object.fromEntries(metric.values.map(({ labels, value }) => [labels.step, value]));
}

async function activity() {
    const metric = await ctx.metrics.registry.getSingleMetric('travelmapster_users').get();
    return Object.fromEntries(metric.values.map(({ labels, value }) => [labels.activity, value]));
}

const place = i => ({ ...sampleMarker, name: `Place ${i}`, travelDate: '' });

test('the funnel counts sign-ups, the first and tenth place and the first ledger use, once each', async () => {
    const client = createClient(ctx.server);
    await client.register('funnel_one', 'funnel password');
    assert.deepEqual(await funnel(), { sign_up: 1 });

    await client.post('/api/markers', place(1));
    await client.post('/api/markers', place(2));
    assert.equal((await funnel()).first_place, 1);

    // An import that crosses ten places counts the step once.
    await client.post('/api/markers/import', { markers: Array.from({ length: 9 }, (_, i) => place(i + 3)) });
    assert.equal((await funnel()).ten_places, 1);
    await client.post('/api/markers', place(12));
    assert.equal((await funnel()).ten_places, 1);

    await client.put('/api/ledger', { dayRule: 'presence', rules: [], planned: [] });
    await client.put('/api/ledger', { dayRule: 'midnight', rules: [], planned: [] });
    assert.equal((await funnel()).first_ledger_use, 1);

    // A whole continent at once counts the first place too.
    const other = createClient(ctx.server);
    await other.register('funnel_two', 'funnel password');
    await other.post('/api/markers/bulk', {
        create: [{ lat: 40, lng: -4, type: 'visited', name: 'Spain', category: 'Country' }], update: [], remove: []
    });
    assert.deepEqual(await funnel(), { sign_up: 2, first_place: 2, ten_places: 1, first_ledger_use: 1 });
});

test('activity counts accounts by their last active day, which a session records once a day', async () => {
    const client = createClient(ctx.server);
    await client.register('active_today', 'active password');
    await client.get('/api/auth/me');
    const { rows } = await ctx.pool.query("SELECT last_seen_on = current_date AS today FROM users WHERE username = 'active_today'");
    assert.equal(rows[0].today, true);

    await ctx.pool.query(`
        INSERT INTO users (username, password_hash, created_at, last_seen_on) VALUES
            ('returning_one', 'x', now() - interval '90 days', current_date - 3),
            ('lapsed_one', 'x', now() - interval '90 days', current_date - 20),
            ('never_back', 'x', now() - interval '90 days', NULL)`);
    const counts = await activity();
    const { rows: [{ total }] } = await ctx.pool.query('SELECT count(*)::int AS total FROM users');
    assert.equal(counts.total, total);
    assert.ok(counts.active_1d >= 1);
    assert.equal(counts.active_7d, counts.active_1d + 1);
    assert.equal(counts.active_30d, counts.active_7d + 1);
    assert.equal(counts.returning_7d, 1);
    // The metrics endpoint text carries no username.
    assert.ok(!(await ctx.metrics.registry.metrics()).includes('returning_one'));
});
