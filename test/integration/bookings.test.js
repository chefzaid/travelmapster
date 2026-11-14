'use strict';

// Bookings on a trip's days: saved with the plan, and never in the family view or calendar feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('a day keeps its bookings, which stay out of the family view and the calendar feed', async () => {
    const client = createClient(ctx.server);
    await client.register('booker', 'booker password');
    const flight = { id: 'b1', kind: 'flight', title: 'TP 1352', time: '09:30', address: 'Lisbon airport', code: 'K7Q2LM' };
    const { body: trip } = await client.post('/api/trips', {
        title: 'Kyoto', destination: 'Kyoto', startDate: '2027-05-01', plan: [{ morning: 'Fly', bookings: [flight] }, {}]
    });
    assert.deepEqual(trip.plan[0].bookings, [flight]);
    assert.ok(!('bookings' in trip.plan[1]));
    const family = new URL((await client.post(`/api/trips/${trip.id}/family-link`)).body.url).pathname.split('/')[2];
    const feed = new URL((await client.post('/api/calendar-feed')).body.url).pathname;
    for (const text of [(await request(ctx.app).get(`/api/family/${family}`)).text, (await request(ctx.app).get(feed)).text]) {
        assert.ok(!/K7Q2LM|TP 1352|Lisbon airport/.test(text), 'no booking leaves the account');
    }
    // Saving the plan without them removes them.
    const saved = await client.put(`/api/trips/${trip.id}`, { title: 'Kyoto', destination: 'Kyoto', startDate: '2027-05-01', plan: [{ morning: 'Fly' }, {}] });
    assert.ok(!('bookings' in saved.body.plan[0]));
});
