'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { Pool } = require('pg');
const { createClient, createTestContext, sampleMarker, DATABASE_URL } = require('../helpers');
const { migrate, listMigrations } = require('../../src/db/migrate');
const { createLogger } = require('../../src/logger');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const place = Object.freeze({ ...sampleMarker, travelDate: undefined });

async function legacyTravelDate(markerId) {
    const { rows } = await ctx.pool.query('SELECT travel_date FROM markers WHERE id = $1', [markerId]);
    return rows[0].travel_date;
}

test('visit routes require authentication and a CSRF token', async () => {
    const anonymous = createClient(ctx.server);
    assert.equal((await anonymous.get('/api/markers/1/visits')).status, 401);
    assert.equal((await anonymous.post('/api/markers/1/visits', { startDate: '2024-01-01' })).status, 401);
    assert.equal((await anonymous.patch('/api/visits/1', { startDate: '2024-01-01' })).status, 401);
    assert.equal((await anonymous.delete('/api/visits/1')).status, 401);

    const client = createClient(ctx.server);
    await client.register('csrf_visitor', 'csrf visitor password');
    const { body: marker } = await client.post('/api/markers', place);
    for (const [method, path] of [['post', `/api/markers/${marker.id}/visits`], ['patch', '/api/visits/1'], ['delete', '/api/visits/1']]) {
        const forged = await client.agent[method](path).set('X-CSRF-Token', 'forged').send({ startDate: '2024-01-01' });
        assert.equal(forged.status, 403, `${method} ${path}`);
    }
    assert.equal((await request(ctx.app).post(`/api/markers/${marker.id}/visits`).send({ startDate: '2024-01-01' })).status, 403);
});

test('a place keeps every visit, newest first, and its latest date', async () => {
    const client = createClient(ctx.server);
    await client.register('repeat_visitor', 'repeat visitor password');
    const { body: marker } = await client.post('/api/markers', place);
    assert.deepEqual(marker.visits, []);
    assert.equal(marker.travelDate, null);

    const first = await client.post(`/api/markers/${marker.id}/visits`, {
        startDate: '2019-07-01', endDate: '2019-07-10', notes: '  First time  ', photoUrl: 'https://example.com/a.jpg', companions: [' Sam ', 'Alex  Doe', 'sam']
    });
    assert.equal(first.status, 201);
    assert.deepEqual(first.body, {
        id: first.body.id, startDate: '2019-07-01', endDate: '2019-07-10', ongoing: false, notes: 'First time', photoUrl: 'https://example.com/a.jpg', purpose: 'personal', organizationId: null,
        companions: ['Sam', 'Alex Doe']
    });
    const second = await client.post(`/api/markers/${marker.id}/visits`, { startDate: '2023-03-04' });
    assert.deepEqual(second.body, { id: second.body.id, startDate: '2023-03-04', endDate: null, ongoing: false, notes: null, photoUrl: null, purpose: 'personal', organizationId: null, companions: [] });
    await client.post(`/api/markers/${marker.id}/visits`, { startDate: '2021-12-31', endDate: '2022-01-02' });

    const list = await client.get(`/api/markers/${marker.id}/visits`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map(visit => visit.startDate), ['2023-03-04', '2021-12-31', '2019-07-01']);

    const [saved] = (await client.get('/api/markers')).body;
    assert.equal(saved.travelDate, '2023-03-04', 'the legacy travel date is the latest visit');
    assert.deepEqual(saved.visits, list.body);
    assert.equal(await legacyTravelDate(marker.id), '2023-03-04', 'the previous release reads the latest visit');

    const edited = await client.patch(`/api/visits/${second.body.id}`, { startDate: '2018-01-01', endDate: '', notes: 'Earlier' });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body, { id: second.body.id, startDate: '2018-01-01', endDate: null, ongoing: false, notes: 'Earlier', photoUrl: null, purpose: 'personal', organizationId: null, companions: [] });
    // Companions left out of an edit stay; an empty list clears them.
    const firstEdited = await client.patch(`/api/visits/${first.body.id}`, { startDate: '2019-07-01', endDate: '2019-07-10' });
    assert.deepEqual(firstEdited.body.companions, ['Sam', 'Alex Doe']);
    assert.deepEqual((await client.patch(`/api/visits/${first.body.id}`, { startDate: '2019-07-01', companions: [] })).body.companions, []);
    await client.patch(`/api/visits/${first.body.id}`, { startDate: '2019-07-01', endDate: '2019-07-10', notes: 'First time', companions: ['Sam'] });
    await client.patch('/api/profile', { profileVisibility: 'public' });
    const visitor = await createClient(ctx.server).get('/api/public/repeat_visitor');
    assert.equal(visitor.status, 200);
    assert.ok(visitor.body.markers[0].visits.length, 'the public map has the visit dates');
    assert.ok(!JSON.stringify(visitor.body).includes('Sam'), 'companions stay off a public map');
    assert.equal(await legacyTravelDate(marker.id), '2021-12-31');

    assert.equal((await client.delete(`/api/visits/${second.body.id}`)).status, 204);
    assert.equal((await client.delete(`/api/visits/${second.body.id}`)).status, 404);
    assert.equal((await client.get(`/api/markers/${marker.id}/visits`)).body.length, 2);

    // Editing the place without a travel date leaves its visits alone.
    const renamed = await client.patch(`/api/markers/${marker.id}`, { ...place, name: 'Paris again', visits: 'ignored' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.visits.length, 2);
    assert.equal(renamed.body.travelDate, '2021-12-31');

    assert.equal((await client.delete(`/api/markers/${marker.id}`)).status, 204);
    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM visits WHERE marker_id = $1', [marker.id]);
    assert.equal(rows[0].n, 0, 'removing a place removes its visits');
});

test('invalid visits are rejected', async () => {
    const client = createClient(ctx.server);
    await client.register('visit_validator', 'visit validator password');
    const { body: marker } = await client.post('/api/markers', place);
    const { body: visit } = await client.post(`/api/markers/${marker.id}/visits`, { startDate: '2024-01-01' });
    const cases = [
        {},
        { startDate: '' },
        { startDate: '2024-02-30' },
        { startDate: '2024-01-01T10:00:00Z' },
        { startDate: '2024-01-05', endDate: '2024-01-04' },
        { startDate: '2024-01-05', endDate: 'soon' },
        { startDate: '2024-01-05', notes: 'x'.repeat(2001) },
        { startDate: '2024-01-05', photoUrl: 'javascript:alert(1)' },
        { startDate: '2024-01-05', photoUrl: 'not a url' },
        { startDate: '2024-01-05', photoUrl: `https://example.com/${'x'.repeat(2048)}` },
        { startDate: '2024-01-05', ongoing: 'yes' },
        { startDate: '2024-01-05', endDate: '2024-01-06', ongoing: true },
        { startDate: '2024-01-05', companions: 'Sam' },
        { startDate: '2024-01-05', companions: [''] },
        { startDate: '2024-01-05', companions: ['x'.repeat(41)] },
        { startDate: '2024-01-05', companions: [7] },
        { startDate: '2024-01-05', companions: Array.from({ length: 11 }, (_, i) => `Friend ${i}`) }
    ];
    for (const body of cases) {
        const created = await client.post(`/api/markers/${marker.id}/visits`, body);
        assert.equal(created.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 80)}`);
        assert.ok(created.body.error);
        assert.equal((await client.patch(`/api/visits/${visit.id}`, body)).status, 400);
    }
    assert.equal((await client.post(`/api/markers/${marker.id}/visits`, [])).status, 400);
    assert.equal((await client.get('/api/markers/abc/visits')).status, 400);
    assert.equal((await client.post('/api/markers/0/visits', { startDate: '2024-01-01' })).status, 400);
    assert.equal((await client.patch('/api/visits/abc', { startDate: '2024-01-01' })).status, 400);
    assert.equal((await client.delete('/api/visits/-1')).status, 400);
    assert.equal((await client.get('/api/markers/999999/visits')).status, 404);

    const badList = await client.post('/api/markers', { ...place, visits: [{ startDate: '2024-01-01' }, { startDate: 'nope' }] });
    assert.equal(badList.status, 400);
    assert.match(badList.body.error, /^Visit 2: /);
    assert.equal((await client.post('/api/markers', { ...place, visits: 'often' })).status, 400);
    const tooMany = await client.post('/api/markers', { ...place, visits: Array(501).fill({ startDate: '2024-01-01' }) });
    assert.equal(tooMany.status, 400);
});

test('users can never see or change each other\'s visits', async () => {
    const owner = createClient(ctx.server);
    await owner.register('visit_owner', 'visit owner password');
    const { body: marker } = await owner.post('/api/markers', { ...place, visits: [{ startDate: '2022-05-05', notes: 'Mine' }] });
    const [visit] = marker.visits;

    const intruder = createClient(ctx.server);
    await intruder.register('visit_intruder', 'visit intruder password');
    assert.equal((await intruder.get(`/api/markers/${marker.id}/visits`)).status, 404);
    assert.equal((await intruder.post(`/api/markers/${marker.id}/visits`, { startDate: '2024-01-01' })).status, 404);
    assert.equal((await intruder.patch(`/api/visits/${visit.id}`, { startDate: '2024-01-01' })).status, 404);
    assert.equal((await intruder.delete(`/api/visits/${visit.id}`)).status, 404);

    const [unchanged] = (await owner.get('/api/markers')).body;
    assert.deepEqual(unchanged.visits, [visit]);
});

test('a place can be created with its visits, as undo and import do', async () => {
    const client = createClient(ctx.server);
    await client.register('restorer', 'restorer password');
    const created = await client.post('/api/markers', {
        ...place,
        travelDate: '1999-01-01',
        visits: [{ id: 7, startDate: '2020-02-02' }, { startDate: '2024-04-04', endDate: '2024-04-08', notes: 'Again' }]
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.visits.map(visit => visit.startDate), ['2024-04-04', '2020-02-02'],
        'visits win over the legacy travel date');
    assert.equal(created.body.travelDate, '2024-04-04');
    assert.notEqual(created.body.visits[1].id, 7, 'ids are assigned by the server');

    const imported = await client.post('/api/markers/import', {
        markers: [
            { ...place, name: 'Old format', travelDate: '2015-06-06' },
            { ...place, name: 'New format', travelDate: '2001-01-01', visits: [{ startDate: '2016-01-01' }, { startDate: '2017-01-01' }] },
            { ...place, name: 'No dates' },
            { ...place, name: 'Broken visit', visits: [{ startDate: '2017-01-02', endDate: '2017-01-01' }] }
        ]
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.imported, 3);
    assert.equal(imported.body.skipped, 1);
    assert.match(imported.body.errors[0].error, /end date/);
    const byName = Object.fromEntries(imported.body.markers.map(marker => [marker.name, marker]));
    assert.deepEqual(byName['Old format'].visits.map(visit => visit.startDate), ['2015-06-06']);
    assert.deepEqual(byName['New format'].visits.map(visit => visit.startDate), ['2017-01-01', '2016-01-01']);
    assert.deepEqual(byName['No dates'].visits, []);
});

test('the previous release keeps working through the legacy travel date', async () => {
    const client = createClient(ctx.server);
    await client.register('old_client', 'old client password');
    // An old browser tab sends every field it knows, including the single travel date.
    const { body: marker } = await client.post('/api/markers', { ...sampleMarker, travelDate: '2020-01-01' });
    assert.equal(marker.visits.length, 1);

    const moved = await client.patch(`/api/markers/${marker.id}`, { ...sampleMarker, travelDate: '2022-02-02' });
    assert.deepEqual(moved.body.visits.map(visit => visit.startDate), ['2022-02-02', '2020-01-01'],
        'a changed date adds a visit and never moves or deletes one');
    const same = await client.patch(`/api/markers/${marker.id}`, { ...sampleMarker, travelDate: '2020-01-01' });
    assert.equal(same.body.visits.length, 2, 'a date that already has a visit adds nothing');
    assert.equal(same.body.travelDate, '2022-02-02');
    const cleared = await client.patch(`/api/markers/${marker.id}`, { ...sampleMarker, travelDate: '' });
    assert.equal(cleared.body.visits.length, 2, 'clearing the date keeps every visit');
    assert.equal(await legacyTravelDate(marker.id), '2022-02-02');

    // The previous release writes the column directly.
    const { rows: [userRow] } = await ctx.pool.query("SELECT id FROM users WHERE username = 'old_client'");
    const { rows: [inserted] } = await ctx.pool.query(
        `INSERT INTO markers (user_id, lat, lng, type, name, category, travel_date)
         VALUES ($1, 1, 2, 'visited', 'Old release', 'City', '2010-10-10') RETURNING id`,
        [userRow.id]
    );
    await ctx.pool.query("UPDATE markers SET name = 'Old release', travel_date = '2011-11-11' WHERE id = $1", [inserted.id]);
    const { rows } = await ctx.pool.query('SELECT start_date FROM visits WHERE marker_id = $1 ORDER BY start_date', [inserted.id]);
    assert.deepEqual(rows.map(row => row.start_date), ['2010-10-10', '2011-11-11']);
    await ctx.pool.query('UPDATE markers SET travel_date = NULL WHERE id = $1', [inserted.id]);
    assert.equal(await legacyTravelDate(inserted.id), '2011-11-11');
});

test('public maps share visit dates but never notes or photo links', async () => {
    const owner = createClient(ctx.server);
    await owner.register('public_visitor', 'public visitor password');
    await owner.post('/api/markers', {
        ...sampleMarker,
        visits: [{ startDate: '2024-01-01', endDate: '2024-01-03', notes: 'Secret', photoUrl: 'https://example.com/me.jpg' }]
    });
    await owner.patch('/api/profile', { profileVisibility: 'public' });

    const profile = await createClient(ctx.server).get('/api/public/public_visitor');
    assert.equal(profile.status, 200);
    const [shared] = profile.body.markers;
    assert.deepEqual(shared.visits, [{ startDate: '2024-01-01', endDate: '2024-01-03' }]);
    assert.equal(shared.travelDate, '2024-01-01');
    assert.doesNotMatch(JSON.stringify(profile.body), /Secret|example\.com|Louvre/);
});

test('migration 004 backfills one visit per dated place from the previous schema', async () => {
    // A separate schema holds a database as the previous release left it.
    await ctx.pool.query('DROP SCHEMA IF EXISTS rollout CASCADE; CREATE SCHEMA rollout');
    const url = new URL(DATABASE_URL);
    url.searchParams.set('options', '-c search_path=rollout');
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    try {
        await pool.query(`CREATE TABLE schema_migrations (
            version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
        for (const migration of listMigrations().filter(item => item.version < '004')) {
            await pool.query(migration.sql);
            await pool.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
        }
        const { rows: [user] } = await pool.query("INSERT INTO users (username, password_hash) VALUES ('legacy', 'x') RETURNING id");
        await pool.query(
            `INSERT INTO markers (user_id, lat, lng, type, name, category, notes, photo_url, travel_date) VALUES
             ($1, 1, 1, 'visited', 'Dated', 'City', 'Place notes', 'https://example.com/p.jpg', '2018-08-08'),
             ($1, 2, 2, 'wishlist', 'Undated', 'Country', NULL, NULL, NULL)`,
            [user.id]
        );

        const applied = await migrate(pool, createLogger('silent'));
        assert.ok(applied.includes('004_visits.sql'));
        const { rows } = await pool.query(
            `SELECT m.name, m.notes, m.travel_date, v.start_date, v.end_date, v.notes AS visit_notes
             FROM markers m LEFT JOIN visits v ON v.marker_id = m.id ORDER BY m.name`
        );
        assert.deepEqual(rows, [
            { name: 'Dated', notes: 'Place notes', travel_date: '2018-08-08', start_date: '2018-08-08', end_date: null, visit_notes: null },
            { name: 'Undated', notes: null, travel_date: null, start_date: null, end_date: null, visit_notes: null }
        ]);

        await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM visits')).rows[0].n, 0, 'deleting the user cascades');
    } finally {
        await pool.end();
        await ctx.pool.query('DROP SCHEMA rollout CASCADE');
    }
});
