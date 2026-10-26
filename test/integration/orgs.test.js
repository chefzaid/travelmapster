'use strict';

// Organizations (ADR 0022, ADR 0029): roles, invitation links, business visits, employer rules,
// the business-day report and its audit log.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function traveler(name, { secondFactor = false } = {}) {
    const client = createClient(ctx.server);
    await client.register(name, `${name} password`);
    if (secondFactor) await addSecondFactor(name);
    return client;
}

// Running an organization needs two-step sign-in or a passkey; here it is switched on directly.
function addSecondFactor(name) {
    return ctx.pool.query("INSERT INTO totp_secrets (user_id, secret, enabled_at) SELECT id, 'sealed', now() FROM users WHERE username = $1", [name]);
}

async function join(client, token) {
    return client.post('/api/orgs/join', { token });
}

test('an organization is created, joined by invitation link, and keeps an admin', async () => {
    const admin = await traveler('acme_admin', { secondFactor: true });
    const created = await admin.post('/api/orgs', { name: ' Acme Corp ' });
    assert.equal(created.status, 201);
    assert.deepEqual([created.body.name, created.body.role, created.body.rules], ['Acme Corp', 'admin', []]);
    assert.equal((await admin.post('/api/orgs', { name: '' })).status, 400);
    const org = created.body.id;

    const invite = await admin.post(`/api/orgs/${org}/invitations`, { role: 'manager' });
    assert.equal(invite.status, 201);
    assert.match(invite.body.token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal((await admin.post(`/api/orgs/${org}/invitations`, { role: 'boss' })).status, 400);
    const { rows: [stored] } = await ctx.pool.query('SELECT token_hash FROM invitations WHERE id = $1', [invite.body.id]);
    assert.notEqual(stored.token_hash, invite.body.token, 'only a hash is kept');
    assert.equal((await admin.get(`/api/orgs/${org}/invitations`)).body.length, 1);

    const manager = await traveler('acme_manager', { secondFactor: true });
    assert.equal((await join(manager, 'short')).status, 400);
    assert.equal((await join(manager, 'x'.repeat(32))).status, 404);
    const joined = await join(manager, invite.body.token);
    assert.deepEqual(joined.body, { id: org, name: 'Acme Corp', role: 'manager' });
    assert.equal((await join(await traveler('latecomer'), invite.body.token)).status, 404, 'a link works once');
    assert.deepEqual((await admin.get(`/api/orgs/${org}/invitations`)).body, []);

    // Roles: admins manage, managers see members, travelers neither.
    const travelerInvite = await admin.post(`/api/orgs/${org}/invitations`, {});
    const member = await traveler('acme_traveler');
    assert.equal((await join(member, travelerInvite.body.token)).body.role, 'traveler');
    assert.deepEqual((await manager.get(`/api/orgs/${org}/members`)).body.map(item => [item.username, item.role]),
        [['acme_admin', 'admin'], ['acme_manager', 'manager'], ['acme_traveler', 'traveler']]);
    assert.equal((await member.get(`/api/orgs/${org}/members`)).status, 403);
    assert.equal((await manager.patch(`/api/orgs/${org}/members/acme_traveler`, { role: 'manager' })).status, 403);
    assert.equal((await manager.post(`/api/orgs/${org}/invitations`, {})).status, 403);
    assert.equal((await (await traveler('outsider')).get(`/api/orgs/${org}/members`)).status, 404);

    // The last admin cannot step down or leave.
    assert.equal((await admin.patch(`/api/orgs/${org}/members/acme_admin`, { role: 'traveler' })).status, 409);
    assert.equal((await admin.delete(`/api/orgs/${org}/members/acme_admin`)).status, 409);
    assert.equal((await admin.patch(`/api/orgs/${org}/members/acme_manager`, { role: 'admin' })).status, 200);
    assert.equal((await admin.delete(`/api/orgs/${org}/members/acme_admin`)).status, 204, 'with another admin, it can leave');
    assert.equal((await member.delete(`/api/orgs/${org}/members/acme_manager`)).status, 403);
    assert.equal((await member.delete(`/api/orgs/${org}/members/acme_traveler`)).status, 204, 'anyone leaves');

    // Revoking a link, renaming and deleting.
    const unused = await manager.post(`/api/orgs/${org}/invitations`, {});
    assert.equal((await manager.delete(`/api/orgs/${org}/invitations/${unused.body.id}`)).status, 204);
    assert.equal((await join(member, unused.body.token)).status, 404);
    assert.deepEqual((await manager.patch(`/api/orgs/${org}`, { name: 'Acme Group' })).body, { id: org, name: 'Acme Group' });
    assert.equal((await manager.delete(`/api/orgs/${org}`)).status, 204);
    assert.deepEqual((await manager.get('/api/orgs')).body, []);
});

test('the report counts business visits only, with the employer\'s rules, and the traveler sees who looked', async () => {
    const admin = await traveler('globex_admin', { secondFactor: true });
    const { body: org } = await admin.post('/api/orgs', { name: 'Globex' });
    const rules = [
        { id: 'fr-30', kind: 'threshold', name: 'France social security', countries: ['FRA'], maxDays: 8, period: 'rolling', windowDays: 365, warnDays: 2 },
        { id: 'jp-90', kind: 'stay', name: 'Japan 90/180', countries: ['JPN'], maxDays: 90, windowDays: 180, warnDays: 10, dayRule: 'presence' }
    ];
    assert.equal((await admin.put(`/api/orgs/${org.id}/rules`, { rules: [{ id: 'bad' }] })).status, 400);
    assert.deepEqual((await admin.put(`/api/orgs/${org.id}/rules`, { rules })).body.rules.map(rule => rule.id), ['fr-30', 'jp-90']);

    const worker = await traveler('globex_worker');
    const { body: invite } = await admin.post(`/api/orgs/${org.id}/invitations`, {});
    await join(worker, invite.token);
    assert.deepEqual((await worker.get('/api/orgs')).body.map(item => [item.name, item.role, item.rules.length]), [['Globex', 'traveler', 2]]);

    const { body: paris } = await worker.post('/api/markers', { ...sampleMarker, travelDate: undefined, visits: [] });
    const business = await worker.post(`/api/markers/${paris.id}/visits`, { startDate: day(-40), endDate: day(-31), purpose: 'business', organizationId: org.id });
    assert.equal(business.status, 201);
    assert.deepEqual([business.body.purpose, business.body.organizationId], ['business', org.id]);
    await worker.post(`/api/markers/${paris.id}/visits`, { startDate: day(-20), endDate: day(-11) });
    assert.equal((await worker.post(`/api/markers/${paris.id}/visits`, { startDate: day(-5), purpose: 'business', organizationId: org.id + 999 })).status, 400, 'only one\'s own organizations');
    assert.equal((await worker.post(`/api/markers/${paris.id}/visits`, { startDate: day(-5), purpose: 'business' })).status, 400);
    assert.equal((await worker.post(`/api/markers/${paris.id}/visits`, { startDate: day(-5), purpose: 'leisure' })).status, 400);
    // A tab of the previous release sends no purpose: the visit stays business.
    const kept = await worker.patch(`/api/visits/${business.body.id}`, { startDate: day(-40), endDate: day(-31), notes: 'Client workshop' });
    assert.equal(kept.body.purpose, 'business');

    assert.equal((await worker.get(`/api/orgs/${org.id}/report`)).status, 403, 'travelers do not see the report');
    const report = await admin.get(`/api/orgs/${org.id}/report?from=${day(-60)}&to=${day(0)}`);
    assert.equal(report.status, 200);
    const row = report.body.members.find(item => item.username === 'globex_worker');
    assert.deepEqual(row.countries, [{ countryId: 'FRA', name: 'France', days: 10 }], 'personal days are not counted');
    assert.deepEqual(row.rules.map(({ ruleId, status, count }) => [ruleId, status, count]), [['jp-90', 'ok', 0], ['fr-30', 'reached', 10]]);
    assert.deepEqual(report.body.members.find(item => item.username === 'globex_admin').countries, []);
    assert.equal(JSON.stringify(report.body).includes('Paris'), false, 'no place names');
    assert.equal(JSON.stringify(report.body).includes('Client workshop'), false, 'no notes');
    assert.equal((await admin.get(`/api/orgs/${org.id}/report?from=${day(0)}&to=${day(-1)}`)).status, 400);
    assert.equal((await admin.get(`/api/orgs/${org.id}/report?from=2026-02-30&to=2026-03-01`)).status, 400);
    const yearly = await admin.get(`/api/orgs/${org.id}/report`);
    assert.match(yearly.body.from, /^\d{4}-01-01$/);

    const audit = (await worker.get('/api/orgs/audit')).body;
    assert.equal(audit.length, 2);
    assert.deepEqual([audit[0].organization, audit[0].actor, audit[0].action], ['Globex', 'globex_admin', 'viewed business-day counts']);
    const archive = (await worker.get('/api/export')).body;
    assert.deepEqual(archive.organizations, [{ name: 'Globex', role: 'traveler' }]);
    assert.equal(archive.auditLog.length, 2);

    // Leaving turns the business visits back into personal ones; so does deleting the organization.
    await worker.delete(`/api/orgs/${org.id}/members/globex_worker`);
    const { body: visits } = await worker.get(`/api/markers/${paris.id}/visits`);
    assert.ok(visits.every(visit => visit.purpose === 'personal' && visit.organizationId === null));
    const other = await traveler('initech_admin', { secondFactor: true });
    const { body: initech } = await other.post('/api/orgs', { name: 'Initech' });
    const { body: place } = await other.post('/api/markers', { ...sampleMarker, travelDate: undefined, visits: [] });
    await other.post(`/api/markers/${place.id}/visits`, { startDate: day(-3), purpose: 'business', organizationId: initech.id });
    await other.delete(`/api/orgs/${initech.id}`);
    assert.equal((await other.get(`/api/markers/${place.id}/visits`)).body[0].purpose, 'personal');
});

test('an account belongs to at most ten organizations', async () => {
    const busy = await traveler('busy_bee', { secondFactor: true });
    for (let i = 0; i < 10; i++) assert.equal((await busy.post('/api/orgs', { name: `Org ${i}` })).status, 201);
    assert.equal((await busy.post('/api/orgs', { name: 'One too many' })).status, 409);
    assert.equal((await createClient(ctx.server).get('/api/orgs')).status, 401);
});

test('running an organization needs a passkey or two-step sign-in', async () => {
    const plain = await traveler('password_only');
    const refused = await plain.post('/api/orgs', { name: 'Weak Co' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'second_factor_required');

    const admin = await traveler('strong_admin', { secondFactor: true });
    const { body: org } = await admin.post('/api/orgs', { name: 'Strong Co' });
    const { body: invite } = await admin.post(`/api/orgs/${org.id}/invitations`, { role: 'manager' });
    assert.equal((await join(plain, invite.token)).body.role, 'manager', 'joining needs no second factor');
    for (const path of [`/api/orgs/${org.id}/members`, `/api/orgs/${org.id}/report`]) {
        assert.equal((await plain.get(path)).body.code, 'second_factor_required', path);
    }
    assert.equal((await plain.delete(`/api/orgs/${org.id}/members/password_only`)).status, 204, 'nor leaving');
});
