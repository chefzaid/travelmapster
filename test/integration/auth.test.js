'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('registration validates credentials', async () => {
    const client = createClient(ctx.server);
    const short = await client.post('/api/auth/register', { username: 'ab', password: 'long enough pw' });
    assert.equal(short.status, 400);
    const weak = await client.post('/api/auth/register', { username: 'someone', password: 'short' });
    assert.equal(weak.status, 400);
    const bad = await client.post('/api/auth/register', { username: 'bad name!', password: 'long enough pw' });
    assert.equal(bad.status, 400);
    const tooLong = await client.post('/api/auth/register', { username: 'someone', password: 'x'.repeat(73) });
    assert.equal(tooLong.status, 400);
});

test('register logs the user in and rejects case-insensitive duplicates', async () => {
    const client = createClient(ctx.server);
    const res = await client.register('Alice', 'wonderland rabbit');
    assert.equal(res.status, 201);
    assert.equal(res.body.user.username, 'Alice');
    assert.equal(res.body.user.profileVisibility, 'private');
    assert.ok(res.body.csrfToken);

    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'Alice');

    const duplicate = await createClient(ctx.server).register('alice', 'another password');
    assert.equal(duplicate.status, 409);
});

test('password hashes are stored with bcrypt, never in plain text', async () => {
    await createClient(ctx.server).register('hashcheck', 'plain text secret');
    const { rows } = await ctx.pool.query("SELECT password_hash FROM users WHERE username = 'hashcheck'");
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);
});

test('login, session and logout lifecycle', async () => {
    await createClient(ctx.server).register('bob', 'builder of things');
    const client = createClient(ctx.server);

    const wrong = await client.post('/api/auth/login', { username: 'bob', password: 'wrong password' });
    assert.equal(wrong.status, 401);
    const unknown = await client.post('/api/auth/login', { username: 'nobody', password: 'whatever pw' });
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.body, wrong.body, 'unknown users and wrong passwords look identical');

    const ok = await client.post('/api/auth/login', { username: 'BOB', password: 'builder of things' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.username, 'bob');
    const cookie = ok.headers['set-cookie'].join(';');
    assert.match(cookie, /travelmapster\.sid=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    assert.equal((await client.get('/api/auth/me')).status, 200);
    assert.equal((await client.post('/api/auth/logout')).status, 200);
    assert.equal((await client.get('/api/auth/me')).status, 401);
});

test('state-changing requests without a CSRF token are rejected', async () => {
    const res = await request(ctx.app)
        .post('/api/auth/login')
        .send({ username: 'bob', password: 'builder of things' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'CSRF');

    const client = createClient(ctx.server);
    await client.register('csrfuser', 'csrf user password');
    const forged = await client.agent.post('/api/markers').set('X-CSRF-Token', 'forged').send({});
    assert.equal(forged.status, 403);
});

test('changing the password needs the current one and signs out other devices', async () => {
    const client = createClient(ctx.server);
    await client.register('mover', 'original password');
    const otherDevice = createClient(ctx.server);
    assert.equal((await otherDevice.post('/api/auth/login', { username: 'mover', password: 'original password' })).status, 200);

    const wrong = await client.post('/api/auth/password', { currentPassword: 'not my password', newPassword: 'brand new password' });
    assert.equal(wrong.status, 400);
    const weak = await client.post('/api/auth/password', { currentPassword: 'original password', newPassword: 'short' });
    assert.equal(weak.status, 400);

    const changed = await client.post('/api/auth/password', { currentPassword: 'original password', newPassword: 'brand new password' });
    assert.equal(changed.status, 200);
    assert.ok(changed.body.csrfToken);
    assert.equal((await client.get('/api/auth/me')).status, 200, 'this device stays signed in');
    assert.equal((await otherDevice.get('/api/auth/me')).status, 401, 'other devices are signed out');

    const fresh = createClient(ctx.server);
    assert.equal((await fresh.post('/api/auth/login', { username: 'mover', password: 'original password' })).status, 401);
    assert.equal((await fresh.post('/api/auth/login', { username: 'mover', password: 'brand new password' })).status, 200);
});

test('deleting the account removes all travel data and every session', async () => {
    const client = createClient(ctx.server);
    const { body } = await client.register('leaver', 'leaving for good');
    await client.post('/api/markers', { lat: 1, lng: 2, type: 'visited', name: 'Somewhere', category: 'City' });
    await client.post('/api/trips', { title: 'Last trip', destination: 'Somewhere', plan: [{ morning: 'Pack' }] });
    const otherDevice = createClient(ctx.server);
    await otherDevice.post('/api/auth/login', { username: 'leaver', password: 'leaving for good' });

    assert.equal((await client.delete('/api/auth/account', { password: 'wrong password' })).status, 400);
    assert.equal((await client.get('/api/auth/me')).status, 200, 'a wrong password deletes nothing');

    const deleted = await client.delete('/api/auth/account', { password: 'leaving for good' });
    assert.equal(deleted.status, 200);
    assert.equal((await client.get('/api/auth/me')).status, 401);
    assert.equal((await otherDevice.get('/api/auth/me')).status, 401);
    for (const table of ['users', 'markers', 'trips']) {
        const column = table === 'users' ? 'id' : 'user_id';
        const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [body.user.id]);
        assert.equal(rows[0].n, 0, `${table} rows are gone`);
    }
    assert.equal((await createClient(ctx.server).register('leaver', 'a new beginning')).status, 201, 'the username is free again');
});

test('account changes require a session', async () => {
    const anonymous = createClient(ctx.server);
    assert.equal((await anonymous.post('/api/auth/password', { currentPassword: 'x', newPassword: 'long enough pw' })).status, 401);
    assert.equal((await anonymous.delete('/api/auth/account', { password: 'x' })).status, 401);
});

test('login is rate limited across replicas', async () => {
    const limited = await createTestContext({ RATE_LIMIT_AUTH: '3' });
    const replica = await limited.createReplica();
    try {
        const first = createClient(limited.server);
        const second = createClient(replica);
        const attempt = client => client.post('/api/auth/login', { username: 'x', password: 'wrong password' });
        assert.equal((await attempt(first)).status, 401);
        assert.equal((await attempt(second)).status, 401);
        assert.equal((await attempt(first)).status, 401);
        // The fourth attempt is blocked even though each replica has seen fewer than three.
        assert.equal((await attempt(second)).status, 429);
    } finally {
        replica.closeAllConnections();
        await new Promise(resolve => replica.close(resolve));
        await limited.close();
    }
});
