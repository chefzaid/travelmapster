'use strict';

// Calendar subscription: a private link to an iCalendar feed of trips and planned stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const plan = n => Array.from({ length: n }, () => ({ morning: 'Private plan', afternoon: '', evening: '' }));

test('a private link serves the trips and planned stays, until it is replaced or turned off', async () => {
    const anonymous = createClient(ctx.server);
    assert.equal((await anonymous.get('/api/calendar-feed')).status, 401);
    const client = createClient(ctx.server);
    await client.register('subscriber', 'subscriber password');
    assert.deepEqual((await client.get('/api/calendar-feed')).body, { active: false, createdAt: null });
    await client.post('/api/trips', { title: 'Porto weekend', destination: 'Porto, Portugal', startDate: '2027-05-01', plan: plan(3) });
    await client.put('/api/ledger', { dayRule: 'presence', planned: [{ id: 'p1', countryId: 'JPN', startDate: '2027-07-01', endDate: '2027-07-10' }] });

    const created = await client.post('/api/calendar-feed');
    assert.equal(created.status, 201);
    assert.equal(created.headers['cache-control'], 'no-store');
    const { pathname } = new URL(created.body.url);
    assert.match(pathname, /^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    const { rows: [stored] } = await ctx.pool.query('SELECT token_hash FROM calendar_feeds');
    assert.ok(!pathname.includes(stored.token_hash), 'only a hash is stored');
    assert.equal((await client.get('/api/calendar-feed')).body.active, true);

    // The feed needs no session: calendar apps fetch it with the link alone.
    const feed = await request(ctx.app).get(pathname);
    assert.equal(feed.status, 200);
    assert.match(feed.headers['content-type'], /^text\/calendar/);
    assert.equal(feed.headers['x-robots-tag'], 'noindex');
    assert.ok(feed.text.includes('SUMMARY:Porto weekend') && feed.text.includes('SUMMARY:Planned stay: Japan'));
    assert.ok(!feed.text.includes('Private plan'), 'never the day plans');

    assert.equal((await request(ctx.app).get('/calendar/not-a-token.ics')).status, 404);
    assert.equal((await request(ctx.app).get(`/calendar/${'a'.repeat(43)}.ics`)).status, 404);

    // A new link ends the old one; turning it off ends both.
    const replaced = new URL((await client.post('/api/calendar-feed')).body.url).pathname;
    assert.equal((await request(ctx.app).get(pathname)).status, 404);
    assert.equal((await request(ctx.app).get(replaced)).status, 200);
    assert.equal((await client.delete('/api/calendar-feed')).status, 204);
    assert.equal((await request(ctx.app).get(replaced)).status, 404);
    assert.deepEqual((await client.get('/api/calendar-feed')).body, { active: false, createdAt: null });
});
