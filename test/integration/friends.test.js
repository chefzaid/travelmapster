'use strict';

// Friends (ADR 0028): following public maps, and trips shared with edit or view roles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

const trip = { title: 'Road trip', destination: 'Portugal', startDate: '2027-06-01', plan: [{ morning: 'Lisbon' }, { morning: 'Porto' }] };

async function traveler(name) {
    const client = createClient(ctx.server);
    await client.register(name, `${name} password`);
    return client;
}

test('travelers follow public maps only, silently, and drop them', async () => {
    const ana = await traveler('ana');
    const ben = await traveler('ben');
    assert.equal((await ana.post('/api/follows', { username: 'ben' })).status, 404, 'a private map cannot be followed');
    await ben.patch('/api/profile', { profileVisibility: 'public' });
    const followed = await ana.post('/api/follows', { username: 'BEN' });
    assert.equal(followed.status, 201);
    assert.deepEqual(followed.body, { username: 'ben', public: true });
    assert.equal((await ana.post('/api/follows', { username: 'ben' })).status, 201, 'following again changes nothing');
    await ana.patch('/api/profile', { profileVisibility: 'public' });
    assert.equal((await ana.post('/api/follows', { username: 'ana' })).status, 400);
    for (const name of ['nobody', 'bad name', '']) assert.equal((await ana.post('/api/follows', { username: name })).status, 404);

    let list = (await ana.get('/api/follows')).body;
    assert.deepEqual(list.map(({ username, public: open }) => [username, open]), [['ben', true]]);
    assert.ok(list[0].since);
    assert.deepEqual((await ben.get('/api/follows')).body, [], 'a follow is one-way');
    // Going private hides the map; the follow stays, shown as private.
    await ben.patch('/api/profile', { profileVisibility: 'private' });
    list = (await ana.get('/api/follows')).body;
    assert.deepEqual(list.map(item => item.public), [false]);
    assert.equal((await ana.get('/api/public/ben')).status, 404);

    assert.equal((await ana.delete('/api/follows/ben')).status, 204);
    assert.equal((await ana.delete('/api/follows/ben')).status, 404);
    assert.deepEqual((await ana.get('/api/follows')).body, []);
    assert.equal((await createClient(ctx.server).get('/api/follows')).status, 401);
});

test('a trip shared with edit and view roles: editors save, viewers read, only the owner shares or deletes', async () => {
    const owner = await traveler('cara');
    const editor = await traveler('dev');
    const viewer = await traveler('eli');
    const stranger = await traveler('fay');
    const { body: created } = await owner.post('/api/trips', trip);
    assert.deepEqual([created.role, created.owner], ['owner', null]);

    const share = (client, name, role) => client.put(`/api/trips/${created.id}/members/${name}`, { role });
    assert.equal((await share(owner, 'dev', 'edit')).status, 200);
    const members = (await share(owner, 'eli', 'view')).body;
    assert.deepEqual(members.map(({ username, role }) => [username, role]), [['dev', 'edit'], ['eli', 'view']]);
    assert.equal((await share(owner, 'nobody', 'view')).status, 404);
    assert.equal((await share(owner, 'cara', 'view')).status, 400);
    assert.equal((await share(owner, 'fay', 'admin')).status, 400);
    assert.equal((await share(editor, 'fay', 'view')).status, 403, 'only the owner shares');
    assert.equal((await share(stranger, 'fay', 'view')).status, 404, 'a stranger does not see it');

    const shared = (await editor.get('/api/trips')).body;
    assert.deepEqual(shared.map(({ title, role, owner: by }) => [title, role, by]), [['Road trip', 'edit', 'cara']]);
    assert.deepEqual((await stranger.get('/api/trips')).body, []);
    assert.deepEqual((await viewer.get(`/api/trips/${created.id}/members`)).body.map(item => item.username), ['dev', 'eli']);

    // The editor saves from the latest copy; a save from an older copy is refused with the newer trip.
    const edited = await editor.put(`/api/trips/${created.id}`, { ...trip, title: 'Road trip, with Sintra', updatedAt: created.updatedAt });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.role, 'edit');
    const stale = await owner.put(`/api/trips/${created.id}`, { ...trip, title: 'Overwrite', updatedAt: created.updatedAt });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.trip.title, 'Road trip, with Sintra');
    assert.equal((await owner.put(`/api/trips/${created.id}`, { ...trip, title: 'Owner wins', updatedAt: stale.body.trip.updatedAt })).status, 200);
    assert.equal((await owner.put(`/api/trips/${created.id}`, { ...trip, title: 'No version, as an older tab' })).status, 200);

    assert.equal((await viewer.put(`/api/trips/${created.id}`, trip)).status, 403);
    assert.equal((await stranger.put(`/api/trips/${created.id}`, trip)).status, 404);
    assert.equal((await editor.delete(`/api/trips/${created.id}`)).status, 403);

    // Roles change, members leave, the owner removes.
    assert.equal((await share(owner, 'eli', 'edit')).status, 200);
    assert.equal((await viewer.put(`/api/trips/${created.id}`, { ...trip, title: 'Now an editor' })).status, 200);
    assert.equal((await editor.delete(`/api/trips/${created.id}/members/eli`)).status, 403);
    assert.equal((await editor.delete(`/api/trips/${created.id}/members/dev`)).status, 204, 'a member leaves');
    assert.deepEqual((await editor.get('/api/trips')).body, []);
    assert.equal((await owner.delete(`/api/trips/${created.id}/members/eli`)).status, 204);
    assert.equal((await owner.delete(`/api/trips/${created.id}/members/eli`)).status, 404);
    assert.equal((await owner.get(`/api/trips/bad/members`)).status, 400);

    // The archive holds the owner's own trips only.
    await share(owner, 'dev', 'view');
    assert.equal((await editor.get('/api/export')).body.trips.length, 0);
    assert.equal((await owner.get('/api/export')).body.trips.length, 1);
    assert.equal((await owner.delete(`/api/trips/${created.id}`)).status, 204);
    assert.deepEqual((await editor.get('/api/trips')).body, [], 'deleting a trip ends its sharing');
});

test('a trip is shared with at most twenty people', async () => {
    const owner = await traveler('gus');
    const { body: created } = await owner.post('/api/trips', trip);
    for (let i = 0; i < 21; i++) await traveler(`mate${i}`);
    for (let i = 0; i < 20; i++) assert.equal((await owner.put(`/api/trips/${created.id}/members/mate${i}`, { role: 'view' })).status, 200);
    assert.equal((await owner.put(`/api/trips/${created.id}/members/mate20`, { role: 'view' })).status, 409);
    assert.equal((await owner.put(`/api/trips/${created.id}/members/mate3`, { role: 'edit' })).status, 200, 'a member\'s role still changes');
});
