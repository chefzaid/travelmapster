'use strict';

// This release no longer reads or writes markers.travel_date (ADR 0009). With the column and
// its triggers dropped, as the next release's migration will, every place route still works.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext, sampleMarker } = require('../helpers');

let ctx;
test.before(async () => {
    ctx = await createTestContext();
    await ctx.pool.query(`
        DROP TRIGGER visits_sync_travel_date ON visits;
        DROP TRIGGER markers_legacy_travel_date_insert ON markers;
        DROP TRIGGER markers_legacy_travel_date_update ON markers;
        DROP FUNCTION visits_sync_travel_date(), markers_legacy_travel_date_insert(), markers_legacy_travel_date_update();
        ALTER TABLE markers DROP COLUMN travel_date;
    `);
});
test.after(async () => { await ctx.close(); });

test('places and visits work without the travel date column', async () => {
    const client = createClient(ctx.server);
    await client.register('contracted', 'contract password');

    // A legacy travel date still becomes the first visit.
    const created = await client.post('/api/markers', sampleMarker);
    assert.equal(created.status, 201);
    assert.equal(created.body.travelDate, '2024-05-12');
    assert.deepEqual(created.body.visits.map(visit => visit.startDate), ['2024-05-12']);

    // An old tab sending a new date adds a visit, the same date adds nothing, clearing keeps them.
    const id = created.body.id;
    const changed = await client.patch(`/api/markers/${id}`, { ...sampleMarker, travelDate: '2025-01-02' });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body.visits.map(visit => visit.startDate), ['2025-01-02', '2024-05-12']);
    assert.equal((await client.patch(`/api/markers/${id}`, { ...sampleMarker, travelDate: '2025-01-02' })).body.visits.length, 2);
    const cleared = await client.patch(`/api/markers/${id}`, { ...sampleMarker, travelDate: '' });
    assert.equal(cleared.body.visits.length, 2);
    assert.equal(cleared.body.travelDate, '2025-01-02');
    // A newer client leaves the date out and the visits alone.
    const withoutDate = { ...sampleMarker, notes: 'Changed' };
    delete withoutDate.travelDate;
    assert.equal((await client.patch(`/api/markers/${id}`, withoutDate)).body.visits.length, 2);

    // Visits, import, bulk changes, the public map and the export.
    assert.equal((await client.post(`/api/markers/${id}/visits`, { startDate: '2026-03-01' })).status, 201);
    const imported = await client.post('/api/markers/import', { markers: [{ ...sampleMarker, name: 'Rome, Italy', travelDate: '2019-09-09' }] });
    assert.equal(imported.body.imported, 1);
    assert.deepEqual(imported.body.markers[0].visits.map(visit => visit.startDate), ['2019-09-09']);
    const bulk = await client.post('/api/markers/bulk', {
        create: [{ lat: 40, lng: -4, type: 'visited', name: 'Spain', category: 'Country' }], update: [], remove: [id]
    });
    assert.equal(bulk.status, 200);
    await client.patch('/api/profile', { profileVisibility: 'public' });
    const shared = await createClient(ctx.server).get('/api/public/contracted');
    assert.equal(shared.status, 200);
    assert.deepEqual(shared.body.markers.map(marker => [marker.name, marker.travelDate]),
        [['Rome, Italy', '2019-09-09'], ['Spain', null]]);
    assert.equal((await client.get('/api/export')).status, 200);
    assert.equal((await client.get('/api/ledger/changes')).status, 200);
});
