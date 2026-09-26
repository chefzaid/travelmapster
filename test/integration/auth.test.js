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

test('login is rate limited', async () => {
    const limited = await createTestContext({ RATE_LIMIT_AUTH: '3' });
    try {
        const client = createClient(limited.server);
        for (let attempt = 0; attempt < 3; attempt += 1) {
            assert.equal((await client.post('/api/auth/login', { username: 'x', password: 'wrong password' })).status, 401);
        }
        const blocked = await client.post('/api/auth/login', { username: 'x', password: 'wrong password' });
        assert.equal(blocked.status, 429);
    } finally {
        await limited.close();
    }
});
