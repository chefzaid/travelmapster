'use strict';

// Family view of a trip: a private, read-only link to its stops and dates (migration 026).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const plan = n => Array.from({ length: n }, () => ({ morning: 'Private plan', afternoon: '', evening: '' }));

test('only the owner makes a family link, which shows the stops and dates and nothing private', async () => {
    const owner = createClient(ctx.server);
    await owner.register('family_owner', 'family owner password');
    const { body: trip } = await owner.post('/api/trips', {
        title: 'Iberia', destination: 'Lisbon, Portugal', startDate: '2027-05-01', plan: plan(5),
        stops: [{ destination: 'Lisbon, Portugal', days: 2 }, { destination: 'Madrid, Spain', days: 3 }],
        packing: [{ item: 'Secret snorkel', packed: false }]
    });
    const path = `/api/trips/${trip.id}/family-link`;
    assert.equal((await createClient(ctx.server).get(path)).status, 401);
    assert.deepEqual((await owner.get(path)).body, { active: false, createdAt: null });

    // Someone the trip is shared with, or anyone else, gets nothing to do with the link.
    const editor = createClient(ctx.server);
    await editor.register('family_editor', 'family editor password');
    await owner.put(`/api/trips/${trip.id}/members/family_editor`, { role: 'edit' });
    for (const [method, call] of [['get', editor.get], ['post', editor.post], ['delete', editor.delete]]) {
        assert.equal((await call.call(editor, path)).status, 404, `${method} by an editor`);
    }
    assert.equal((await owner.get('/api/trips/999999/family-link')).status, 404);
    assert.equal((await owner.post('/api/trips/nope/family-link')).status, 404);

    const created = await owner.post(path);
    assert.equal(created.status, 201);
    const { pathname } = new URL(created.body.url);
    const [, token] = /^\/family\/([A-Za-z0-9_-]{43})$/.exec(pathname);
    const { rows: [stored] } = await ctx.pool.query('SELECT token_hash FROM trip_family_links WHERE trip_id = $1', [trip.id]);
    assert.notEqual(stored.token_hash, token, 'only a hash is stored');
    assert.equal((await owner.get(path)).body.active, true);

    // The page and the view need no account.
    const page = await request(ctx.app).get(pathname);
    assert.equal(page.status, 200);
    assert.equal(page.headers['x-robots-tag'], 'noindex');
    assert.match(page.text, /family\.js/);
    const view = await request(ctx.app).get(`/api/family/${token}`);
    assert.equal(view.status, 200);
    assert.deepEqual({ ...view.body, updatedAt: undefined }, {
        traveler: 'family_owner', title: 'Iberia', startDate: '2027-05-01', days: 5, updatedAt: undefined,
        stops: [
            { destination: 'Lisbon, Portugal', firstDay: 0, days: 2, startDate: '2027-05-01', endDate: '2027-05-02' },
            { destination: 'Madrid, Spain', firstDay: 2, days: 3, startDate: '2027-05-03', endDate: '2027-05-05' }
        ]
    });
    assert.ok(!/Private plan|Secret snorkel|family_editor/.test(view.text), 'never plans, packing or the people it is shared with');
    assert.equal((await request(ctx.app).get('/api/family/short')).status, 404);
    assert.equal((await request(ctx.app).get(`/api/family/${'a'.repeat(43)}`)).status, 404);

    // A new link ends the old one; turning it off ends both, and deleting the trip ends it too.
    const replaced = new URL((await owner.post(path)).body.url).pathname.split('/')[2];
    assert.equal((await request(ctx.app).get(`/api/family/${token}`)).status, 404);
    assert.equal((await request(ctx.app).get(`/api/family/${replaced}`)).status, 200);
    assert.equal((await owner.delete(path)).status, 204);
    assert.equal((await request(ctx.app).get(`/api/family/${replaced}`)).status, 404);
    assert.deepEqual((await owner.get(path)).body, { active: false, createdAt: null });
    assert.equal((await owner.delete(path)).status, 204, 'turning off twice is fine');
    const again = new URL((await owner.post(path)).body.url).pathname.split('/')[2];
    await owner.delete(`/api/trips/${trip.id}`);
    assert.equal((await request(ctx.app).get(`/api/family/${again}`)).status, 404);
});
