'use strict';

// Personal API tokens: read-only access to the traveler's own data, never to sign-in security,
// revocable, in the security activity, and on an organization's audit log when used for a report.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const bearer = token => ({ Authorization: `Bearer ${token}` });

test('a token reads the traveler\'s data, never writes or reaches sign-in security, and ends when revoked', async () => {
    const client = createClient(ctx.server);
    await client.register('integrator', 'integrator password');
    await client.post('/api/markers', { lat: 38.72, lng: -9.14, type: 'visited', name: 'Lisbon', category: 'City' });
    assert.equal((await createClient(ctx.server).get('/api/api-tokens')).status, 401);
    assert.equal((await client.post('/api/api-tokens', { name: '' })).status, 400);

    const created = await client.post('/api/api-tokens', { name: ' Accountant ' });
    assert.equal(created.status, 201);
    const { token, id, name } = created.body;
    assert.match(token, /^tmk_[A-Za-z0-9_-]{43}$/);
    assert.equal(name, 'Accountant');
    const { rows: [stored] } = await ctx.pool.query('SELECT token_hash FROM api_tokens WHERE id = $1', [id]);
    assert.notEqual(stored.token_hash, token, 'only a hash is stored');
    assert.ok(!('token' in (await client.get('/api/api-tokens')).body[0]), 'the token is shown only once');

    // No session, no CSRF token: the bearer token alone reads.
    const places = await request(ctx.app).get('/api/markers').set(bearer(token));
    assert.equal(places.status, 200);
    assert.equal(places.body[0].name, 'Lisbon');
    assert.equal((await request(ctx.app).get('/api/auth/me').set(bearer(token))).body.user.username, 'integrator');
    assert.equal((await request(ctx.app).get('/api/ledger').set(bearer(token))).status, 200);
    assert.equal((await request(ctx.app).get('/api/export').set(bearer(token))).body.security.apiTokens[0].name, 'Accountant');
    assert.ok((await client.get('/api/api-tokens')).body[0].lastUsedAt, 'its last use is noted');

    const refused = await request(ctx.app).post('/api/markers').set(bearer(token)).send({ lat: 1, lng: 1, type: 'visited', name: 'X', category: 'City' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'API tokens can only read.');
    for (const path of ['/api/security', '/api/api-tokens']) {
        assert.equal((await request(ctx.app).get(path).set(bearer(token))).status, 403, path);
    }
    for (const wrong of ['tmk_nope', `tmk_${'a'.repeat(43)}`, 'not-a-token']) {
        assert.equal((await request(ctx.app).get('/api/markers').set(bearer(wrong))).status, 401, wrong);
    }

    const activity = (await client.get('/api/security')).body.activity.map(event => event.kind);
    assert.equal(activity[0], 'api_token_created');
    assert.equal((await client.delete(`/api/api-tokens/${id}`)).status, 204);
    assert.equal((await client.delete(`/api/api-tokens/${id}`)).status, 404);
    assert.equal((await request(ctx.app).get('/api/markers').set(bearer(token))).status, 401);
    assert.equal((await client.get('/api/security')).body.activity[0].kind, 'api_token_revoked');

    // Another traveler's token reads only their own map; the account holds ten at most.
    const other = createClient(ctx.server);
    await other.register('other_integrator', 'other integrator password');
    const theirs = (await other.post('/api/api-tokens', { name: 'HR' })).body.token;
    assert.deepEqual((await request(ctx.app).get('/api/markers').set(bearer(theirs))).body, []);
    for (let i = 1; i < 10; i++) assert.equal((await other.post('/api/api-tokens', { name: `T${i}` })).status, 201);
    assert.equal((await other.post('/api/api-tokens', { name: 'One too many' })).status, 409);
});

test('an admin\'s token reads the organization report, which goes on the audit log as such', async () => {
    const admin = createClient(ctx.server);
    await admin.register('token_admin', 'token admin password');
    await ctx.pool.query("INSERT INTO totp_secrets (user_id, secret, enabled_at) SELECT id, 'sealed', now() FROM users WHERE username = 'token_admin'");
    const { body: org } = await admin.post('/api/orgs', { name: 'Payroll Co' });
    const invite = (await admin.post(`/api/orgs/${org.id}/invitations`, {})).body;
    const worker = createClient(ctx.server);
    await worker.register('token_worker', 'token worker password');
    await worker.post('/api/orgs/join', { token: invite.token });

    const { token } = (await admin.post('/api/api-tokens', { name: 'Payroll sync' })).body;
    const report = await request(ctx.app).get(`/api/orgs/${org.id}/report`).set(bearer(token));
    assert.equal(report.status, 200);
    const audit = (await worker.get('/api/orgs/audit')).body;
    assert.ok(audit.some(entry => entry.action === 'viewed business-day counts through an API token'), JSON.stringify(audit));
});
