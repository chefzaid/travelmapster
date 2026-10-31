'use strict';

// Packing list templates saved on the account (migration 024).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('packing list templates are saved on the account, exported and kept private', async () => {
    const client = createClient(ctx.server);
    await client.register('template_packer', 'template password');
    assert.deepEqual((await client.get('/api/auth/me')).body.user.packingTemplates, []);

    const packingTemplates = [{ name: 'Ski week', items: ['Gloves', 'Goggles'] }, { name: 'Weekend', items: ['Book'] }];
    const saved = await client.patch('/api/profile', { packingTemplates });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.packingTemplates, packingTemplates);
    assert.deepEqual((await client.get('/api/auth/me')).body.user.packingTemplates, packingTemplates);
    // Other settings leave the templates alone.
    await client.patch('/api/profile', { profileVisibility: 'public' });
    assert.equal((await client.get('/api/auth/me')).body.user.packingTemplates.length, 2);
    const visitor = await createClient(ctx.server).get('/api/public/template_packer');
    assert.ok(!JSON.stringify(visitor.body).includes('Goggles'), 'templates stay off the public map');
    assert.deepEqual((await client.get('/api/export')).body.profile.packingTemplates, packingTemplates);

    for (const bad of ['list', [{ name: 'Ski week', items: [] }], [{ name: 'A', items: ['x'] }, { name: 'a', items: ['y'] }]]) {
        assert.equal((await client.patch('/api/profile', { packingTemplates: bad })).status, 400, JSON.stringify(bad));
    }
    assert.deepEqual((await client.patch('/api/profile', { packingTemplates: [] })).body.packingTemplates, []);
});
