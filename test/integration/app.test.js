'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('only the public/ directory is served', async () => {
    const http = request(ctx.app);
    for (const path of ['/markers.db', '/server.js', '/src/app.js', '/package.json', '/package-lock.json', '/.env', '/.git/config', '/../package.json']) {
        const res = await http.get(path);
        assert.equal(res.status, 404, `${path} must not be served`);
    }
    const index = await http.get('/').expect(200);
    assert.match(index.text, /<title>[^<]*TravelMapster[^<]*<\/title>/);
    await http.get('/js/app.js').expect(200);
    await http.get('/data/countries.geojson').expect(200);
    await http.get('/vendor/leaflet/leaflet.js').expect(200);
});

test('security headers are set', async () => {
    const res = await request(ctx.app).get('/');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
});

test('health and readiness endpoints', async () => {
    await request(ctx.app).get('/healthz').expect(200, { status: 'ok' });
    await request(ctx.app).get('/readyz').expect(200, { status: 'ready' });
    ctx.state.shuttingDown = true;
    await request(ctx.app).get('/readyz').expect(503);
    ctx.state.shuttingDown = false;
});

test('unknown API routes and malformed bodies return JSON errors', async () => {
    const client = createClient(ctx.server);
    const missing = await client.get('/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'Not found.');

    const token = (await client.get('/api/csrf-token')).body.csrfToken;
    const malformed = await client.agent.post('/api/auth/login')
        .set('X-CSRF-Token', token)
        .set('Content-Type', 'application/json')
        .send('{"username":');
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.error, /valid JSON/);
});

test('profile visibility controls the public map', async () => {
    const owner = createClient(ctx.server);
    await owner.register('explorer', 'explorer password');
    await owner.post('/api/markers', sampleMarker);

    const visitor = createClient(ctx.server);
    assert.equal((await visitor.get('/api/public/explorer')).status, 404);

    assert.equal((await owner.patch('/api/profile', { profileVisibility: 'sideways' })).status, 400);
    const changed = await owner.patch('/api/profile', { profileVisibility: 'public' });
    assert.deepEqual(changed.body, { profileVisibility: 'public' });
    assert.equal((await owner.get('/api/auth/me')).body.user.profileVisibility, 'public');

    const profile = await visitor.get('/api/public/Explorer');
    assert.equal(profile.status, 200);
    assert.equal(profile.body.username, 'explorer');
    assert.equal(profile.body.markers.length, 1);
    assert.equal(profile.body.markers[0].notes, undefined, 'notes stay private');
    assert.equal(profile.body.markers[0].photoUrl, undefined, 'photo links stay private');

    assert.equal((await visitor.get('/api/public/nobody-here')).status, 404);
    assert.equal((await visitor.get('/api/public/bad%20name')).status, 404);
});

test('geocode proxy requires login, validates input and hides upstream failures', async () => {
    const client = createClient(ctx.server);
    assert.equal((await client.get('/api/geocode?q=Paris')).status, 401);

    await client.register('geo', 'geocoding password');
    const ok = await client.get('/api/geocode?q=Paris&kind=city&limit=3');
    assert.equal(ok.status, 200);
    assert.equal(ok.body[0].name, 'Paris, Testland');
    assert.deepEqual(ctx.geocoder.calls.at(-1), { query: 'Paris', kind: 'city', limit: 3 });

    assert.equal((await client.get('/api/geocode?q=P')).status, 400);
    assert.equal((await client.get('/api/geocode?q=Paris&kind=planet')).status, 400);

    ctx.geocoder.failNext = true;
    const failed = await client.get('/api/geocode?q=Paris');
    assert.equal(failed.status, 502);
});

test('migrations are recorded and idempotent', async () => {
    const { migrate, listMigrations } = require('../../src/db/migrate');
    const { createLogger } = require('../../src/logger');
    assert.deepEqual(await migrate(ctx.pool, createLogger('silent')), []);
    const { rows } = await ctx.pool.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(rows.map(row => row.version), listMigrations().map(migration => migration.version));
});
