'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('yearly goals are saved with the profile, sorted, and stay private', async () => {
    const client = createClient(ctx.server);
    await client.register('goal_setter', 'goal password');
    assert.deepEqual((await client.get('/api/auth/me')).body.user.goals, []);

    const goals = [{ year: 2027, kind: 'visits', target: 6 }, { year: 2027, kind: 'countries', target: 3 }, { year: 2026, kind: 'cities', target: 10 }];
    const saved = await client.patch('/api/profile', { goals });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.goals, [
        { year: 2026, kind: 'cities', target: 10 }, { year: 2027, kind: 'countries', target: 3 }, { year: 2027, kind: 'visits', target: 6 }
    ]);
    assert.deepEqual((await client.get('/api/auth/me')).body.user.goals, saved.body.goals);
    // Other settings leave the goals alone.
    await client.patch('/api/profile', { profileVisibility: 'public' });
    assert.equal((await client.get('/api/auth/me')).body.user.goals.length, 3);
    assert.ok(!('goals' in (await createClient(ctx.server).get('/api/public/goal_setter')).body), 'goals stay off the public map');
    assert.equal((await client.get('/api/export')).body.profile.goals.length, 3);

    assert.deepEqual((await client.patch('/api/profile', { goals: [] })).body.goals, []);
});

test('goals are validated', async () => {
    const client = createClient(ctx.server);
    await client.register('goal_checker', 'goal password');
    const goal = { year: 2027, kind: 'countries', target: 3 };
    for (const goals of [
        'three', [{ ...goal, year: 1999 }], [{ ...goal, kind: 'oceans' }], [{ ...goal, target: 0 }], [{ ...goal, target: 2.5 }],
        [goal, { ...goal, target: 5 }], Array.from({ length: 13 }, (_, i) => ({ ...goal, year: 2030 + i }))
    ]) {
        assert.equal((await client.patch('/api/profile', { goals })).status, 400, JSON.stringify(goals));
    }
});
