'use strict';

// Sign-in security (ADR 0027): two-step sign-in with codes and recovery codes, and passkeys.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');
const { createAuthenticator } = require('../fixtures/authenticator');
const totp = require('../../src/totp');

let ctx;
test.before(async () => { ctx = await createTestContext({ PUBLIC_URL: 'http://travel.test' }); });
test.after(async () => { await ctx.close(); });

const codeFor = (secret, offset = 0) => totp.hotp(totp.base32Decode(secret), Math.floor(Date.now() / 30_000) + offset);

test('two-step sign-in asks for a code after the password, and recovery codes work once', async () => {
    const client = createClient(ctx.server);
    await client.register('stepper', 'stepper password');
    const { sessions, ...status } = (await client.get('/api/security')).body;
    assert.deepEqual(status, { passkeys: [], twoStep: { enabled: false, recoveryCodesLeft: 0 } });
    assert.equal(sessions.length, 1);

    assert.equal((await client.post('/api/security/two-step/enable', { code: '123456' })).status, 400, 'set up first');
    const setup = await client.post('/api/security/two-step/setup');
    assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.body.uri, /^otpauth:\/\/totp\/TravelMapster%3Astepper\?secret=/);
    const { rows: [stored] } = await ctx.pool.query('SELECT secret FROM totp_secrets');
    assert.ok(!stored.secret.includes(setup.body.secret), 'the secret is encrypted at rest');

    assert.equal((await client.post('/api/security/two-step/enable', { code: '000000' })).status, 400);
    // Kept to replay later: a new code from the clock would be valid once the 30-second step turns.
    const enablingCode = codeFor(setup.body.secret);
    const enabled = await client.post('/api/security/two-step/enable', { code: enablingCode });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.recoveryCodes.length, 10);
    assert.equal((await client.post('/api/security/two-step/setup')).status, 409);
    assert.equal((await client.post('/api/security/two-step/enable', { code: codeFor(setup.body.secret) })).status, 409);
    assert.deepEqual((await client.get('/api/security')).body.twoStep, { enabled: true, recoveryCodesLeft: 10 });

    // A password alone no longer opens the session.
    await client.post('/api/auth/logout');
    const first = await client.post('/api/auth/login', { username: 'stepper', password: 'stepper password' });
    assert.deepEqual(first.body, { secondStep: true });
    assert.equal((await client.get('/api/auth/me')).status, 401);
    assert.equal((await client.post('/api/auth/login/second-step', { code: '000000' })).status, 400);
    // The code used to turn the step on cannot be used again; the next one can.
    assert.equal((await client.post('/api/auth/login/second-step', { code: enablingCode })).status, 400);
    const opened = await client.post('/api/auth/login/second-step', { code: codeFor(setup.body.secret, 1) });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.user.username, 'stepper');
    assert.equal((await client.get('/api/auth/me')).status, 200);

    // A recovery code instead, once.
    const [recovery] = enabled.body.recoveryCodes;
    await client.post('/api/auth/logout');
    await client.post('/api/auth/login', { username: 'stepper', password: 'stepper password' });
    assert.equal((await client.post('/api/auth/login/second-step', { recoveryCode: recovery.toUpperCase() })).status, 200);
    await client.post('/api/auth/logout');
    await client.post('/api/auth/login', { username: 'stepper', password: 'stepper password' });
    assert.equal((await client.post('/api/auth/login/second-step', { recoveryCode: recovery })).status, 400);
    assert.equal((await client.post('/api/auth/login/second-step', { recoveryCode: enabled.body.recoveryCodes[1] })).status, 200);
    assert.equal((await client.get('/api/security')).body.twoStep.recoveryCodesLeft, 8);

    // Five wrong codes end the attempt; so does a second step without a password first.
    await client.post('/api/auth/logout');
    await client.post('/api/auth/login', { username: 'stepper', password: 'stepper password' });
    for (let i = 0; i < 5; i++) assert.equal((await client.post('/api/auth/login/second-step', { code: '000000' })).status, 400);
    assert.equal((await client.post('/api/auth/login/second-step', { code: codeFor(setup.body.secret, 1) })).status, 401);
    const stranger = createClient(ctx.server);
    assert.equal((await stranger.post('/api/auth/login/second-step', { code: '123456' })).status, 401);

    // Turning it off needs the password.
    await client.post('/api/auth/login', { username: 'stepper', password: 'stepper password' });
    await client.post('/api/auth/login/second-step', { recoveryCode: enabled.body.recoveryCodes[2] });
    assert.equal((await client.post('/api/security/two-step/disable', { password: 'wrong password' })).status, 400);
    assert.equal((await client.post('/api/security/two-step/disable', { password: 'stepper password' })).status, 204);
    await client.post('/api/auth/logout');
    const plain = await client.post('/api/auth/login', { username: 'stepper', password: 'stepper password' });
    assert.equal(plain.body.user.username, 'stepper');
});

test('a passkey is added, signs in without a password, and can be removed', async () => {
    const client = createClient(ctx.server);
    assert.equal((await client.post('/api/security/passkeys/options')).status, 401);
    await client.register('keyholder', 'keyholder password');
    const authenticator = createAuthenticator({ origin: 'http://travel.test' });

    const options = await client.post('/api/security/passkeys/options');
    assert.equal(options.body.rp.id, 'travel.test');
    assert.equal(options.body.authenticatorSelection.residentKey, 'required');
    assert.equal(options.body.authenticatorSelection.userVerification, 'required');
    assert.notEqual(Buffer.from(options.body.user.id, 'base64url').toString(), '1', 'an opaque user handle');
    const added = await client.post('/api/security/passkeys', { name: ' Laptop ', response: authenticator.register(options.body) });
    assert.equal(added.status, 201);
    assert.deepEqual([added.body.id, added.body.name, added.body.transports], [authenticator.id, 'Laptop', ['internal']]);
    assert.equal((await client.post('/api/security/passkeys', { response: authenticator.register(options.body) })).status, 400, 'a challenge is used once');
    const again = await client.post('/api/security/passkeys/options');
    assert.deepEqual(again.body.excludeCredentials.map(item => item.id), [authenticator.id]);
    assert.equal((await client.post('/api/security/passkeys', { response: authenticator.register(again.body) })).status, 409);

    // Signing in on another device: no username, no password.
    const device = createClient(ctx.server);
    const challenge = await device.post('/api/security/passkey-login/options');
    assert.equal(challenge.body.rpId, 'travel.test');
    const signedIn = await device.post('/api/security/passkey-login', { response: authenticator.signIn(challenge.body) });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.user.username, 'keyholder');
    assert.equal((await device.get('/api/auth/me')).body.user.username, 'keyholder');
    const [stored] = (await client.get('/api/security')).body.passkeys;
    assert.ok(stored.lastUsedAt);

    // Refused: a reused challenge, no user verification, an unknown key.
    const other = createClient(ctx.server);
    assert.equal((await other.post('/api/security/passkey-login', { response: authenticator.signIn(challenge.body) })).status, 401);
    const fresh = await other.post('/api/security/passkey-login/options');
    assert.equal((await other.post('/api/security/passkey-login', { response: authenticator.signIn(fresh.body, { verified: false }) })).status, 401);
    const unknown = createAuthenticator({ origin: 'http://travel.test' });
    const third = await other.post('/api/security/passkey-login/options');
    assert.equal((await other.post('/api/security/passkey-login', { response: unknown.signIn(third.body) })).status, 401);
    assert.equal((await other.post('/api/security/passkey-login', { response: {} })).status, 401);
    // Another site's origin is refused too.
    const phishing = createAuthenticator({ origin: 'http://evil.test' });
    const phishingOptions = await client.post('/api/security/passkeys/options');
    assert.equal((await client.post('/api/security/passkeys', { response: phishing.register(phishingOptions.body) })).status, 400);

    assert.equal((await client.post('/api/security/passkeys', { name: 'x'.repeat(61), response: {} })).status, 400);
    assert.equal((await client.delete('/api/security/passkeys/unknown')).status, 404);
    assert.equal((await client.delete(`/api/security/passkeys/${encodeURIComponent(authenticator.id)}`)).status, 204);
    assert.deepEqual((await client.get('/api/security')).body.passkeys, []);
});

test('a passkey sign-in needs no second step, and an account holds at most ten passkeys', async () => {
    const client = createClient(ctx.server);
    await client.register('belt', 'belt and braces');
    const keys = [];
    for (let i = 0; i < 10; i++) {
        const authenticator = createAuthenticator({ origin: 'http://travel.test' });
        const options = await client.post('/api/security/passkeys/options');
        assert.equal((await client.post('/api/security/passkeys', { name: `Key ${i}`, response: authenticator.register(options.body) })).status, 201);
        keys.push(authenticator);
    }
    assert.equal((await client.post('/api/security/passkeys/options')).status, 409);
    const setup = await client.post('/api/security/two-step/setup');
    await client.post('/api/security/two-step/enable', { code: codeFor(setup.body.secret) });
    const device = createClient(ctx.server);
    const challenge = await device.post('/api/security/passkey-login/options');
    assert.equal((await device.post('/api/security/passkey-login', { response: keys[3].signIn(challenge.body) })).status, 200);
    // Deleting the account removes its passkeys and secrets.
    assert.equal((await client.delete('/api/auth/account', { password: 'belt and braces' })).status, 200);
    const { rows } = await ctx.pool.query('SELECT (SELECT count(*) FROM passkeys)::int AS keys, (SELECT count(*) FROM totp_secrets)::int AS secrets');
    assert.deepEqual(rows[0], { keys: 0, secrets: 0 });
});

test('the devices signed in are listed, and any other one can be signed out', async () => {
    const signIn = client => client.post('/api/auth/login', { username: 'devices', password: 'devices password' });
    const laptop = createClient(ctx.server, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' });
    await laptop.register('devices', 'devices password');
    const phone = createClient(ctx.server, { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
    await signIn(phone);
    const desktop = createClient(ctx.server, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0' });
    await signIn(desktop);

    const { sessions } = (await laptop.get('/api/security')).body;
    assert.equal(sessions.length, 3);
    const [current] = sessions.filter(session => session.current);
    assert.deepEqual([current.browser, current.os], ['Safari', 'macOS']);
    const other = sessions.find(session => session.browser === 'Chrome');
    assert.equal(other.os, 'Android');
    assert.match(other.id, /^[0-9a-f]{24}$/);
    assert.ok(Date.parse(other.signedInAt) && Date.parse(other.lastSeenAt));

    assert.equal((await laptop.delete(`/api/security/sessions/${current.id}`)).status, 400, 'this device signs out from the menu');
    assert.equal((await laptop.delete('/api/security/sessions/not-a-session')).status, 400);
    assert.equal((await laptop.delete(`/api/security/sessions/${'0'.repeat(24)}`)).status, 404);
    // Someone else cannot sign these out.
    const stranger = createClient(ctx.server);
    await stranger.register('devices_stranger', 'devices stranger password');
    assert.equal((await stranger.delete(`/api/security/sessions/${other.id}`)).status, 404);

    assert.equal((await laptop.delete(`/api/security/sessions/${other.id}`)).status, 204);
    assert.equal((await phone.get('/api/auth/me')).status, 401, 'the phone is signed out');
    assert.equal((await desktop.get('/api/auth/me')).status, 200);
    assert.equal((await laptop.delete('/api/security/sessions')).status, 204);
    assert.equal((await desktop.get('/api/auth/me')).status, 401, 'every other device is signed out');
    assert.equal((await laptop.get('/api/auth/me')).status, 200, 'but not this one');
    assert.equal((await laptop.get('/api/security')).body.sessions.length, 1);
});
