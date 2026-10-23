'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('marker routes require authentication', async () => {
    const client = createClient(ctx.server);
    assert.equal((await client.get('/api/markers')).status, 401);
    assert.equal((await client.post('/api/markers', sampleMarker)).status, 401);
    assert.equal((await client.patch('/api/markers/1', sampleMarker)).status, 401);
    assert.equal((await client.delete('/api/markers/1')).status, 401);
});

test('create, list, update and delete a marker', async () => {
    const client = createClient(ctx.server);
    await client.register('mapper', 'mapper password');

    const created = await client.post('/api/markers', sampleMarker);
    assert.equal(created.status, 201);
    assert.equal(typeof created.body.id, 'number');
    const { visits, ...place } = created.body;
    assert.deepEqual({ ...place, id: undefined }, {
        ...sampleMarker, id: undefined, rating: null, tags: [], emoji: null, hideFromPublic: false, priority: null, bestMonths: [],
        stay: 'visit'
    });
    assert.equal(visits.length, 1, 'the travel date becomes the first visit');
    assert.equal(visits[0].startDate, sampleMarker.travelDate);

    const list = await client.get('/api/markers');
    assert.deepEqual(list.body, [created.body]);

    const updated = await client.patch(`/api/markers/${created.body.id}`, {
        ...sampleMarker, type: 'wishlist', notes: '', photoUrl: '', travelDate: ''
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.type, 'wishlist');
    assert.equal(updated.body.notes, null);
    assert.equal(updated.body.photoUrl, null);
    assert.equal(updated.body.travelDate, sampleMarker.travelDate, 'clearing the legacy date keeps the visits');

    assert.equal((await client.delete(`/api/markers/${created.body.id}`)).status, 204);
    assert.equal((await client.delete(`/api/markers/${created.body.id}`)).status, 404);
    assert.deepEqual((await client.get('/api/markers')).body, []);
});

test('invalid marker payloads are rejected', async () => {
    const client = createClient(ctx.server);
    await client.register('validator', 'validator password');
    const cases = [
        { lat: 91 },
        { lng: -181 },
        { lat: '' },
        { type: 'maybe' },
        { category: 'Planet' },
        { name: '   ' },
        { name: 'x'.repeat(201) },
        { notes: 'x'.repeat(2001) },
        { travelDate: '2024-02-30' },
        { photoUrl: 'javascript:alert(1)' },
        { photoUrl: 'not a url' }
    ];
    for (const override of cases) {
        const res = await client.post('/api/markers', { ...sampleMarker, ...override });
        assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(override)}`);
        assert.ok(res.body.error);
    }
    assert.equal((await client.patch('/api/markers/abc', sampleMarker)).status, 400);
    assert.equal((await client.delete('/api/markers/0')).status, 400);
});

test('users can never read or change each other\'s markers', async () => {
    const owner = createClient(ctx.server);
    await owner.register('owner', 'owner password');
    const { body: marker } = await owner.post('/api/markers', sampleMarker);

    const intruder = createClient(ctx.server);
    await intruder.register('intruder', 'intruder password');
    assert.deepEqual((await intruder.get('/api/markers')).body, []);
    assert.equal((await intruder.patch(`/api/markers/${marker.id}`, sampleMarker)).status, 404);
    assert.equal((await intruder.delete(`/api/markers/${marker.id}`)).status, 404);
    assert.equal((await owner.get('/api/markers')).body.length, 1);
});

test('bulk import stores valid places and reports skipped ones', async () => {
    const client = createClient(ctx.server);
    await client.register('importer', 'importer password');
    const res = await client.post('/api/markers/import', {
        markers: [sampleMarker, { ...sampleMarker, name: 'Lyon, France' }, { ...sampleMarker, lat: 500 }]
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.imported, 2);
    assert.equal(res.body.skipped, 1);
    assert.equal(res.body.errors[0].index, 2);
    assert.equal((await client.get('/api/markers')).body.length, 2);

    assert.equal((await client.post('/api/markers/import', { markers: 'nope' })).status, 400);
    const tooMany = await client.post('/api/markers/import', { markers: Array(1001).fill(sampleMarker) });
    assert.equal(tooMany.status, 413);
});

test('deleting a user cascades to their markers', async () => {
    const client = createClient(ctx.server);
    const { body } = await client.register('leaver', 'leaver password');
    await client.post('/api/markers', sampleMarker);
    await ctx.pool.query('DELETE FROM users WHERE id = $1', [body.user.id]);
    const { rows } = await ctx.pool.query('SELECT count(*)::int AS count FROM markers WHERE user_id = $1', [body.user.id]);
    assert.equal(rows[0].count, 0);
    assert.equal((await client.get('/api/auth/me')).status, 401, 'stale sessions are logged out');
});

test('a place keeps a rating, tags and an emoji, and older clients leave them alone', async () => {
    const client = createClient(ctx.server);
    await client.register('rater', 'rater password');
    const created = await client.post('/api/markers', {
        ...sampleMarker, rating: 4, tags: ['Food', ' street   food ', 'food', 'café & bar'], emoji: ' 🥐 '
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.rating, 4);
    assert.deepEqual(created.body.tags, ['food', 'street food', 'café & bar'], 'tags are lowercased and deduplicated');
    assert.equal(created.body.emoji, '🥐');

    // The previous release's tabs send only the fields they know: the details stay.
    const renamed = await client.patch(`/api/markers/${created.body.id}`, { ...sampleMarker, name: 'Paris again' });
    assert.equal(renamed.status, 200);
    assert.deepEqual([renamed.body.rating, renamed.body.tags, renamed.body.emoji], [4, ['food', 'street food', 'café & bar'], '🥐']);

    const changed = await client.patch(`/api/markers/${created.body.id}`, { ...sampleMarker, rating: 5, tags: ['hiking'], emoji: '👨‍👩‍👧‍👦' });
    assert.deepEqual([changed.body.rating, changed.body.tags, changed.body.emoji], [5, ['hiking'], '👨‍👩‍👧‍👦']);
    const cleared = await client.patch(`/api/markers/${created.body.id}`, { ...sampleMarker, rating: null, tags: [], emoji: '' });
    assert.deepEqual([cleared.body.rating, cleared.body.tags, cleared.body.emoji], [null, [], null]);

    for (const emoji of ['🇯🇵', '#️⃣', '🏳️‍🌈', '❤️']) {
        const res = await client.patch(`/api/markers/${created.body.id}`, { ...sampleMarker, emoji });
        assert.equal(res.body.emoji, emoji, emoji);
    }

    // The previous release writes markers without the new columns.
    const { rows: [user] } = await ctx.pool.query("SELECT id FROM users WHERE username = 'rater'");
    const { rows: [old] } = await ctx.pool.query(
        `INSERT INTO markers (user_id, lat, lng, type, name, category) VALUES ($1, 1, 2, 'visited', 'Old release', 'City') RETURNING id`,
        [user.id]
    );
    await ctx.pool.query("UPDATE markers SET rating = 3, tags = '{work}' WHERE id = $1", [old.id]);
    await ctx.pool.query("UPDATE markers SET name = 'Old release, renamed', notes = 'n' WHERE id = $1", [old.id]);
    const listed = (await client.get('/api/markers')).body.find(marker => marker.id === old.id);
    assert.deepEqual([listed.rating, listed.tags, listed.emoji], [3, ['work'], null]);
});

test('invalid ratings, tags and emoji are rejected', async () => {
    const client = createClient(ctx.server);
    await client.register('detail_validator', 'detail validator password');
    const { body: marker } = await client.post('/api/markers', sampleMarker);
    const cases = [
        { rating: 0 },
        { rating: 6 },
        { rating: 4.5 },
        { rating: '4' },
        { tags: 'food' },
        { tags: [42] },
        { tags: ['x'.repeat(25)] },
        { tags: ['-dash'] },
        { tags: ['semi;colon'] },
        { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] },
        { emoji: 'a' },
        { emoji: '1' },
        { emoji: '😀😀' },
        { emoji: 'x😀' },
        { emoji: 7 },
        { emoji: '<script>' }
    ];
    for (const override of cases) {
        const res = await client.post('/api/markers', { ...sampleMarker, ...override });
        assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(override)}`);
        assert.ok(res.body.error);
        assert.equal((await client.patch(`/api/markers/${marker.id}`, { ...sampleMarker, ...override })).status, 400);
    }
    // The schema holds the limits too.
    await assert.rejects(ctx.pool.query('UPDATE markers SET rating = 9 WHERE id = $1', [marker.id]));
    await assert.rejects(ctx.pool.query("UPDATE markers SET tags = ARRAY['a','b','c','d','e','f','g','h','i'] WHERE id = $1", [marker.id]));
    await assert.rejects(ctx.pool.query("UPDATE markers SET tags = ARRAY[''] WHERE id = $1", [marker.id]));
});

test('public maps never share ratings, tags or emoji', async () => {
    const owner = createClient(ctx.server);
    await owner.register('public_rater', 'public rater password');
    await owner.post('/api/markers', { ...sampleMarker, rating: 2, tags: ['work', 'secret tag'], emoji: '🏥' });
    await owner.patch('/api/profile', { profileVisibility: 'public' });
    const profile = await createClient(ctx.server).get('/api/public/public_rater');
    assert.equal(profile.status, 200);
    const [shared] = profile.body.markers;
    assert.equal(shared.name, sampleMarker.name);
    for (const field of ['rating', 'tags', 'emoji', 'notes', 'photoUrl']) assert.equal(shared[field], undefined, field);
    assert.doesNotMatch(JSON.stringify(profile.body), /secret tag|🏥/);
});

test('places hidden from the public map never appear on it', async () => {
    const owner = createClient(ctx.server);
    await owner.register('hider', 'hider password');
    const { body: shown } = await owner.post('/api/markers', { ...sampleMarker, name: 'Shown, France' });
    const { body: hidden } = await owner.post('/api/markers', {
        ...sampleMarker, name: 'Clinic, Switzerland', hideFromPublic: true,
        visits: [{ startDate: '2025-03-03', endDate: '2025-03-09' }]
    });
    assert.equal(hidden.hideFromPublic, true);
    assert.equal(shown.hideFromPublic, false, 'places are shared unless hidden');
    await owner.patch('/api/profile', { profileVisibility: 'public' });

    const visitor = createClient(ctx.server);
    const publicNames = async () => (await visitor.get('/api/public/hider')).body.markers.map(marker => marker.name);
    assert.deepEqual(await publicNames(), ['Shown, France']);
    const body = JSON.stringify((await visitor.get('/api/public/hider')).body);
    assert.doesNotMatch(body, /Clinic|2025-03-0|hideFromPublic/, 'neither the place nor its visits leak');
    assert.equal((await owner.get('/api/markers')).body.length, 2, 'the owner still sees every place');

    // An older client's update keeps the place hidden; the owner can share it again.
    await owner.patch(`/api/markers/${hidden.id}`, { ...sampleMarker, name: 'Clinic, Switzerland' });
    assert.deepEqual(await publicNames(), ['Shown, France']);
    await ctx.pool.query("UPDATE markers SET notes = 'previous release' WHERE id = $1", [hidden.id]);
    assert.deepEqual(await publicNames(), ['Shown, France']);
    await owner.patch(`/api/markers/${hidden.id}`, { ...sampleMarker, name: 'Clinic, Switzerland', hideFromPublic: false });
    assert.deepEqual(await publicNames(), ['Shown, France', 'Clinic, Switzerland']);
    await owner.patch(`/api/markers/${shown.id}`, { ...sampleMarker, name: 'Shown, France', hideFromPublic: true });
    assert.deepEqual(await publicNames(), ['Clinic, Switzerland']);

    // Only the owner can change it, and only to true or false.
    const intruder = createClient(ctx.server);
    await intruder.register('hide_intruder', 'hide intruder password');
    assert.equal((await intruder.patch(`/api/markers/${hidden.id}`, { ...sampleMarker, hideFromPublic: true })).status, 404);
    assert.deepEqual(await publicNames(), ['Clinic, Switzerland']);
    for (const hideFromPublic of ['yes', 1, 'true']) {
        assert.equal((await owner.patch(`/api/markers/${hidden.id}`, { ...sampleMarker, hideFromPublic })).status, 400);
    }
    const forged = await owner.agent.patch(`/api/markers/${hidden.id}`).set('X-CSRF-Token', 'forged').send({ ...sampleMarker, hideFromPublic: true });
    assert.equal(forged.status, 403);
    assert.equal((await createClient(ctx.server).patch(`/api/markers/${hidden.id}`, sampleMarker)).status, 401);
});

test('wishlist places keep a priority and the best months to go', async () => {
    const client = createClient(ctx.server);
    await client.register('dreamer', 'dreamer password');
    const wish = { ...sampleMarker, type: 'wishlist', name: 'Japan', category: 'Country', travelDate: undefined };
    const created = await client.post('/api/markers', { ...wish, priority: 'high', bestMonths: [11, 3, 4, 3] });
    assert.equal(created.status, 201);
    assert.deepEqual([created.body.priority, created.body.bestMonths], ['high', [3, 4, 11]], 'months are sorted and unique');

    const renamed = await client.patch(`/api/markers/${created.body.id}`, { ...wish, name: 'Japan!' });
    assert.deepEqual([renamed.body.priority, renamed.body.bestMonths], ['high', [3, 4, 11]], 'older clients keep the plans');
    const cleared = await client.patch(`/api/markers/${created.body.id}`, { ...wish, priority: '', bestMonths: null });
    assert.deepEqual([cleared.body.priority, cleared.body.bestMonths], [null, []]);

    for (const override of [{ priority: 'urgent' }, { priority: 1 }, { bestMonths: [0] }, { bestMonths: [13] }, { bestMonths: ['4'] },
        { bestMonths: 4 }, { bestMonths: [4.5] }]) {
        const res = await client.post('/api/markers', { ...wish, ...override });
        assert.equal(res.status, 400, JSON.stringify(override));
        assert.equal((await client.patch(`/api/markers/${created.body.id}`, { ...wish, ...override })).status, 400);
    }
    await assert.rejects(ctx.pool.query("UPDATE markers SET best_months = '{0}' WHERE id = $1", [created.body.id]));
    await assert.rejects(ctx.pool.query("UPDATE markers SET priority = 'now' WHERE id = $1", [created.body.id]));

    await client.patch(`/api/markers/${created.body.id}`, { ...wish, priority: 'low', bestMonths: [10] });
    await client.patch('/api/profile', { profileVisibility: 'public' });
    const [shared] = (await createClient(ctx.server).get('/api/public/dreamer')).body.markers;
    assert.equal(shared.name, 'Japan');
    assert.equal(shared.priority, undefined);
    assert.equal(shared.bestMonths, undefined);
});

test('bulk changes mark several places in one transaction and undo them', async () => {
    const client = createClient(ctx.server);
    await client.register('bulk_marker', 'bulk marker password');
    const country = (name, lat, lng, type = 'visited') => ({ lat, lng, type, name, category: 'Country' });
    const { body: spain } = await client.post('/api/markers', country('Spain', 40, -4, 'wishlist'));

    const marked = await client.post('/api/markers/bulk', {
        create: [country('France', 46, 2), country('Italy', 42, 12)],
        update: [{ id: spain.id, type: 'visited' }]
    });
    assert.equal(marked.status, 200);
    assert.deepEqual(marked.body.created.map(marker => marker.name), ['France', 'Italy']);
    assert.deepEqual(marked.body.updated.map(marker => [marker.id, marker.type]), [[spain.id, 'visited']]);
    assert.deepEqual(marked.body.removed, []);
    assert.equal((await client.get('/api/markers')).body.length, 3);

    // Undo is one bulk change too: remove what was created and restore the status.
    const undone = await client.post('/api/markers/bulk', {
        remove: marked.body.created.map(marker => marker.id),
        update: [{ id: spain.id, type: 'wishlist' }]
    });
    assert.equal(undone.status, 200);
    assert.deepEqual((await client.get('/api/markers')).body.map(marker => [marker.name, marker.type]), [['Spain', 'wishlist']]);

    // All or nothing: one bad place rejects the whole change.
    const invalid = await client.post('/api/markers/bulk', { create: [country('Peru', -10, -75), country('Nowhere', 95, 0)] });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /^Place 2: /);
    const missing = await client.post('/api/markers/bulk', { create: [country('Peru', -10, -75)], remove: [999999] });
    assert.equal(missing.status, 404);
    assert.equal((await client.get('/api/markers')).body.length, 1, 'nothing was kept from the failed change');

    for (const body of [[], {}, { create: 'x' }, { update: [{ id: spain.id, type: 'maybe' }] }, { update: [{ type: 'visited' }] },
        { remove: ['abc'] }, { remove: [spain.id], update: [{ id: spain.id, type: 'visited' }] }, { remove: Array(301).fill(1) }]) {
        assert.equal((await client.post('/api/markers/bulk', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
});

test('bulk changes are scoped to the owner and protected like every write', async () => {
    const owner = createClient(ctx.server);
    await owner.register('bulk_owner', 'bulk owner password');
    const { body: place } = await owner.post('/api/markers', { ...sampleMarker });
    const intruder = createClient(ctx.server);
    await intruder.register('bulk_intruder', 'bulk intruder password');
    assert.equal((await intruder.post('/api/markers/bulk', { update: [{ id: place.id, type: 'wishlist' }] })).status, 404);
    assert.equal((await intruder.post('/api/markers/bulk', { remove: [place.id], create: [sampleMarker] })).status, 404);
    assert.equal((await intruder.get('/api/markers')).body.length, 0, 'the intruder\'s own create was rolled back');
    const [kept] = (await owner.get('/api/markers')).body;
    assert.equal(kept.type, 'visited');

    assert.equal((await createClient(ctx.server).post('/api/markers/bulk', { remove: [place.id] })).status, 401);
    const forged = await owner.agent.post('/api/markers/bulk').set('X-CSRF-Token', 'forged').send({ remove: [place.id] });
    assert.equal(forged.status, 403);
    assert.equal((await owner.get('/api/markers')).body.length, 1);
});

test('places lived in or passed through keep how the traveler was there (ADR 0014)', async () => {
    const client = createClient(ctx.server);
    await client.register('resident', 'resident password');
    const berlin = { ...sampleMarker, name: 'Berlin, Germany', lat: 52.52, lng: 13.4, travelDate: undefined };
    const lived = await client.post('/api/markers', {
        ...berlin, stay: 'lived', visits: [{ startDate: '2015-09-01', endDate: '2019-06-30' }]
    });
    assert.equal(lived.status, 201);
    assert.equal(lived.body.stay, 'lived');
    const { body: layover } = await client.post('/api/markers', { ...sampleMarker, name: 'Dubai, United Arab Emirates', stay: 'transit' });
    assert.equal(layover.stay, 'transit');
    const { body: plain } = await client.post('/api/markers', { ...sampleMarker, name: 'Rome, Italy' });
    assert.equal(plain.stay, 'visit', 'a place is a plain visit unless told otherwise');

    // Older clients leave it alone; moving a place to the wishlist resets it.
    const renamed = await client.patch(`/api/markers/${lived.body.id}`, { ...berlin, name: 'Berlin!' });
    assert.equal(renamed.body.stay, 'lived');
    const wished = await client.patch(`/api/markers/${lived.body.id}`, { ...berlin, type: 'wishlist' });
    assert.equal(wished.body.stay, 'visit');
    const back = await client.patch(`/api/markers/${lived.body.id}`, { ...berlin, type: 'visited' });
    assert.equal(back.body.stay, 'visit', 'a wish forgot that the traveler lived there');
    const visited = await client.patch(`/api/markers/${layover.id}`, { ...sampleMarker, name: 'Dubai, United Arab Emirates', stay: 'visit' });
    assert.equal(visited.body.stay, 'visit');

    for (const override of [{ stay: 'home' }, { stay: 1 }, { stay: ['lived'] }, { type: 'wishlist', stay: 'lived' }, { type: 'wishlist', stay: 'transit' }]) {
        assert.equal((await client.post('/api/markers', { ...sampleMarker, ...override })).status, 400, JSON.stringify(override));
        assert.equal((await client.patch(`/api/markers/${plain.id}`, { ...sampleMarker, ...override })).status, 400);
    }
    await assert.rejects(ctx.pool.query("UPDATE markers SET stay = 'home' WHERE id = $1", [plain.id]));

    // Imports and bulk changes carry it too; a bulk change without it keeps it.
    const imported = await client.post('/api/markers/import', { markers: [{ ...sampleMarker, name: 'Doha, Qatar', stay: 'transit' }] });
    assert.equal(imported.body.markers[0].stay, 'transit');
    const bulk = await client.post('/api/markers/bulk', {
        update: [{ id: imported.body.markers[0].id, type: 'visited', stay: 'visit' }, { id: back.body.id, type: 'visited' }]
    });
    assert.deepEqual(bulk.body.updated.map(marker => marker.stay), ['visit', 'visit']);
    await client.post('/api/markers/bulk', { update: [{ id: back.body.id, type: 'visited', stay: 'lived' }] });
    const intruder = createClient(ctx.server);
    await intruder.register('stay_intruder', 'stay intruder password');
    assert.equal((await intruder.patch(`/api/markers/${back.body.id}`, { ...berlin, stay: 'transit' })).status, 404);
    assert.equal((await intruder.post('/api/markers/bulk', { update: [{ id: back.body.id, type: 'visited', stay: 'transit' }] })).status, 404);

    // The previous release moves a place to the wishlist without knowing the column.
    await ctx.pool.query("UPDATE markers SET type = 'wishlist' WHERE id = $1", [back.body.id]);
    const listed = (await client.get('/api/markers')).body.find(marker => marker.id === back.body.id);
    assert.equal(listed.stay, 'visit', 'a wishlist place is never lived in');

    // A public map shows how the traveler was there, never the home country.
    await ctx.pool.query("UPDATE markers SET type = 'visited' WHERE id = $1", [back.body.id]);
    await client.patch('/api/profile', { profileVisibility: 'public', homeCountry: 'DEU' });
    const shared = (await createClient(ctx.server).get('/api/public/resident')).body;
    assert.deepEqual(shared.markers.map(marker => [marker.name, marker.stay]),
        [['Berlin, Germany', 'lived'], ['Dubai, United Arab Emirates', 'visit'], ['Rome, Italy', 'visit'], ['Doha, Qatar', 'visit']]);
    assert.doesNotMatch(JSON.stringify(shared), /DEU|homeCountry/);
});
