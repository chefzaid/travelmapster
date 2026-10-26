'use strict';

// Pre-trip checklists (ADR 0030): an organization's tasks before a trip, and business trips.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const trip = { title: 'Client visit', destination: 'Germany', startDate: '2027-06-01', plan: [{ morning: 'Berlin' }, { morning: 'Munich' }] };
const a1 = { id: 'a1', task: 'A1 certificate', countries: ['DEU', 'FRA'], daysBefore: 14, link: 'https://europa.eu/youreurope/' };

async function traveler(name) {
    const client = createClient(ctx.server);
    await client.register(name, `${name} password`);
    return client;
}

test('admins keep a checklist, and travelers plan business trips only for their organizations', async () => {
    const admin = await traveler('check_admin');
    await ctx.pool.query("INSERT INTO totp_secrets (user_id, secret, enabled_at) SELECT id, 'sealed', now() FROM users WHERE username = 'check_admin'");
    const { body: org } = await admin.post('/api/orgs', { name: 'Initrode' });
    assert.deepEqual(org.checklist, []);
    for (const bad of [[{ ...a1, task: '' }], [{ ...a1, countries: [] }], [{ ...a1, daysBefore: 400 }], [{ ...a1, link: 'javascript:alert(1)' }], [a1, a1], 'list']) {
        assert.equal((await admin.put(`/api/orgs/${org.id}/checklist`, { checklist: bad })).status, 400, JSON.stringify(bad));
    }
    const saved = await admin.put(`/api/orgs/${org.id}/checklist`, { checklist: [a1, { id: 'brief', task: ' Travel risk briefing ', countries: ['DEU'], daysBefore: 0 }] });
    assert.deepEqual(saved.body.checklist[1], { id: 'brief', task: 'Travel risk briefing', countries: ['DEU'], daysBefore: 0, link: null });

    const worker = await traveler('check_worker');
    const { body: invite } = await admin.post(`/api/orgs/${org.id}/invitations`, {});
    await worker.post('/api/orgs/join', { token: invite.token });
    const [mine] = (await worker.get('/api/orgs')).body;
    assert.equal(mine.checklist.length, 2);
    assert.equal((await worker.put(`/api/orgs/${org.id}/checklist`, { checklist: [] })).status, 403);

    // A business trip, and one for someone else's organization.
    const created = await worker.post('/api/trips', { ...trip, organizationId: org.id });
    assert.equal(created.status, 201);
    assert.equal(created.body.organizationId, org.id);
    assert.equal((await worker.post('/api/trips', { ...trip, organizationId: org.id + 1000 })).status, 400);
    assert.equal((await worker.post('/api/trips', { ...trip, organizationId: 'acme' })).status, 400);
    assert.equal((await worker.post('/api/trips', trip)).body.organizationId, null);

    // An update that leaves it out keeps it; an editor cannot change it; the owner can.
    const id = created.body.id;
    assert.equal((await worker.put(`/api/trips/${id}`, { ...trip, title: 'Client visit 2' })).body.organizationId, org.id);
    const editor = await traveler('check_editor');
    await worker.put(`/api/trips/${id}/members/check_editor`, { role: 'edit' });
    assert.equal((await editor.put(`/api/trips/${id}`, { ...trip, organizationId: null })).body.organizationId, org.id);
    assert.equal((await worker.put(`/api/trips/${id}`, { ...trip, organizationId: null })).body.organizationId, null);
    await worker.put(`/api/trips/${id}`, { ...trip, organizationId: org.id });

    // Leaving the organization turns the trip personal again.
    await worker.delete(`/api/orgs/${org.id}/members/check_worker`);
    assert.equal((await worker.get('/api/trips')).body.find(item => item.id === id).organizationId, null);
});
