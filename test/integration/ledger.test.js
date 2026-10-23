'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const place = Object.freeze({ ...sampleMarker, travelDate: undefined });

const schengenish = Object.freeze({
    id: 'nordic', kind: 'stay', name: 'Nordic 30/60', countries: ['NOR', 'SWE'], maxDays: 30, windowDays: 60, warnDays: 5, dayRule: 'presence'
});
const taxRule = Object.freeze({
    id: 'uk-tax', kind: 'threshold', name: 'UK tax year', countries: ['GBR'], maxDays: 90, period: 'year', yearStart: '04-06', warnDays: 20
});
const settings = Object.freeze({
    dayRule: 'midnight',
    rules: [schengenish, taxRule, { id: 'r3', kind: 'threshold', name: 'Rolling', countries: ['ESP'], maxDays: 100, period: 'rolling', windowDays: 365, warnDays: 0 }],
    planned: [{ id: 'p1', countryId: 'PRT', startDate: '2027-01-01', endDate: '2027-01-20' }]
});

test('ledger routes require authentication and a CSRF token', async () => {
    const anonymous = createClient(ctx.server);
    assert.equal((await anonymous.get('/api/ledger')).status, 401);
    assert.equal((await anonymous.get('/api/ledger/changes')).status, 401);
    assert.equal((await anonymous.put('/api/ledger', settings)).status, 401);

    const client = createClient(ctx.server);
    await client.register('ledger_csrf', 'ledger csrf password');
    assert.equal((await client.agent.put('/api/ledger').set('X-CSRF-Token', 'forged').send(settings)).status, 403);
    assert.equal((await request(ctx.app).put('/api/ledger').send(settings)).status, 403);
});

test('settings start with the defaults and are saved per traveler', async () => {
    const client = createClient(ctx.server);
    await client.register('ledger_owner', 'ledger owner password');
    const initial = await client.get('/api/ledger');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { dayRule: 'presence', rules: [], planned: [], updatedAt: null });

    const saved = await client.put('/api/ledger', { ...settings, rules: [{ ...schengenish, name: '  Nordic 30/60  ', extra: 'dropped' }, ...settings.rules.slice(1)] });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.dayRule, 'midnight');
    assert.deepEqual(saved.body.rules, settings.rules, 'rules are trimmed and unknown fields dropped');
    assert.deepEqual(saved.body.planned, settings.planned);
    assert.ok(saved.body.updatedAt);

    const again = await client.put('/api/ledger', { dayRule: 'presence', rules: [], planned: [] });
    assert.equal(again.status, 200);
    assert.deepEqual((await client.get('/api/ledger')).body.rules, []);

    // Another traveler never sees or changes these settings.
    await client.put('/api/ledger', settings);
    const other = createClient(ctx.server);
    await other.register('ledger_other', 'ledger other password');
    assert.deepEqual((await other.get('/api/ledger')).body.rules, []);
    await other.put('/api/ledger', { dayRule: 'presence' });
    assert.equal((await client.get('/api/ledger')).body.dayRule, 'midnight');
});

test('invalid ledger settings are rejected', async () => {
    const client = createClient(ctx.server);
    await client.register('ledger_validator', 'ledger validator password');
    const withRule = rule => ({ dayRule: 'presence', rules: [rule] });
    const withStay = stay => ({ dayRule: 'presence', planned: [stay] });
    const stay = settings.planned[0];
    const cases = [
        [],
        { dayRule: 'noon' },
        { dayRule: 'presence', rules: 'none' },
        { dayRule: 'presence', rules: Array.from({ length: 21 }, (_, i) => ({ ...schengenish, id: `r${i}` })) },
        { dayRule: 'presence', rules: [schengenish, schengenish] },
        withRule(null),
        withRule({ ...schengenish, id: 'bad id!' }),
        withRule({ ...schengenish, name: '' }),
        withRule({ ...schengenish, countries: [] }),
        withRule({ ...schengenish, countries: ['france'] }),
        withRule({ ...schengenish, countries: Array(81).fill('FRA') }),
        withRule({ ...schengenish, maxDays: 61 }),
        withRule({ ...schengenish, maxDays: 1.5 }),
        withRule({ ...schengenish, windowDays: 0 }),
        withRule({ ...schengenish, warnDays: -1 }),
        withRule({ ...schengenish, dayRule: 'noon' }),
        withRule({ ...schengenish, kind: 'visa' }),
        withRule({ ...taxRule, yearStart: '02-29' }),
        withRule({ ...taxRule, yearStart: '4-6' }),
        withRule({ ...taxRule, maxDays: 367 }),
        withRule({ ...taxRule, period: 'decade' }),
        withRule({ ...taxRule, period: 'rolling', windowDays: 30, maxDays: 31 }),
        { dayRule: 'presence', planned: 'soon' },
        withStay({ ...stay, countryId: 'Portugal' }),
        withStay({ ...stay, endDate: '2026-12-31' }),
        withStay({ ...stay, startDate: '2027-02-30' }),
        withStay({ ...stay, endDate: '2038-01-01' }),
        withStay({ ...stay, id: '' }),
        { dayRule: 'presence', planned: Array.from({ length: 31 }, (_, i) => ({ ...stay, id: `p${i}` })) }
    ];
    for (const body of cases) {
        const res = await client.put('/api/ledger', body);
        assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 120)}`);
        assert.ok(res.body.error);
    }
    assert.equal((await client.get('/api/ledger')).body.updatedAt, null, 'nothing was saved');
});

test('visits can be still going on, which stays private on public maps', async () => {
    const client = createClient(ctx.server);
    await client.register('still_there', 'still there password');
    const { body: marker } = await client.post('/api/markers', { ...place, visits: [{ startDate: '2026-09-01', ongoing: true }] });
    assert.equal(marker.visits[0].ongoing, true);
    assert.equal(marker.visits[0].endDate, null);

    const ended = await client.patch(`/api/visits/${marker.visits[0].id}`, { startDate: '2026-09-01', endDate: '2026-09-30' });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.ongoing, false, 'an edit without the flag ends the stay');

    await client.post(`/api/markers/${marker.id}/visits`, { startDate: '2026-10-10', ongoing: true });
    await client.patch('/api/profile', { profileVisibility: 'public' });
    const profile = await createClient(ctx.server).get('/api/public/still_there');
    assert.doesNotMatch(JSON.stringify(profile.body), /ongoing/, 'where the traveler is right now is never shared');
});

test('every change to visit dates is kept, newest first', async () => {
    const client = createClient(ctx.server);
    await client.register('history_keeper', 'history keeper password');
    const { body: marker } = await client.post('/api/markers', { ...place, name: 'Lisbon, Portugal', visits: [{ startDate: '2024-05-01', endDate: '2024-05-04' }] });
    const [visit] = marker.visits;

    await client.patch(`/api/visits/${visit.id}`, { startDate: '2024-05-01', endDate: '2024-05-06', notes: 'Longer' });
    await client.patch(`/api/visits/${visit.id}`, { startDate: '2024-05-01', endDate: '2024-05-06', notes: 'Only notes changed' });
    const second = await client.post(`/api/markers/${marker.id}/visits`, { startDate: '2025-01-01', ongoing: true });
    await client.delete(`/api/visits/${second.body.id}`);

    const { body: changes, status } = await client.get('/api/ledger/changes');
    assert.equal(status, 200);
    assert.deepEqual(changes.map(change => [change.action, change.visitId]), [
        ['removed', second.body.id], ['added', second.body.id], ['changed', visit.id], ['added', visit.id]
    ], 'notes edits are not date changes');
    const changed = changes[2];
    assert.equal(changed.placeName, 'Lisbon, Portugal');
    assert.equal(changed.markerId, marker.id);
    assert.deepEqual(
        [changed.oldStartDate, changed.oldEndDate, changed.oldOngoing, changed.newStartDate, changed.newEndDate, changed.newOngoing],
        ['2024-05-01', '2024-05-04', false, '2024-05-01', '2024-05-06', false]
    );
    assert.ok(!Number.isNaN(Date.parse(changed.changedAt)));
    assert.equal(changes[0].oldOngoing, true);
    assert.equal(changes[0].newStartDate, null);

    // Removing the place records its visits as removed, under the name they had.
    await client.patch(`/api/markers/${marker.id}`, { ...place, name: 'Lisboa' });
    assert.equal((await client.delete(`/api/markers/${marker.id}`)).status, 204);
    const [latest] = (await client.get('/api/ledger/changes')).body;
    assert.deepEqual([latest.action, latest.visitId, latest.placeName, latest.oldEndDate], ['removed', visit.id, 'Lisboa', '2024-05-06']);
    assert.equal((await client.get('/api/ledger/changes')).body.filter(change => change.action === 'removed').length, 2, 'recorded once');

    // Another traveler never sees this history.
    const other = createClient(ctx.server);
    await other.register('history_other', 'history other password');
    assert.deepEqual((await other.get('/api/ledger/changes')).body, []);
});

test('writes of the previous release are recorded too, and the history goes with the account', async () => {
    const client = createClient(ctx.server);
    await client.register('history_legacy', 'history legacy password');
    const { body: marker } = await client.post('/api/markers', { ...sampleMarker, travelDate: '2020-01-01' });
    await client.patch(`/api/markers/${marker.id}`, { ...sampleMarker, travelDate: '2021-02-02' });
    // The previous release inserts visits without the ongoing column.
    await ctx.pool.query("INSERT INTO visits (marker_id, start_date) VALUES ($1, '2022-03-03')", [marker.id]);
    const changes = (await client.get('/api/ledger/changes')).body;
    assert.deepEqual(changes.map(change => [change.action, change.newStartDate, change.newOngoing]).sort(), [
        ['added', '2020-01-01', false], ['added', '2021-02-02', false], ['added', '2022-03-03', false]
    ]);

    await client.put('/api/ledger', settings);
    const { rows: [user] } = await ctx.pool.query("SELECT id FROM users WHERE username = 'history_legacy'");
    assert.equal((await client.delete('/api/auth/account', { password: 'history legacy password' })).status, 200);
    for (const table of ['visit_changes', 'ledger_settings']) {
        const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [user.id]);
        assert.equal(rows[0].n, 0, `${table} rows go with the account`);
    }
});
