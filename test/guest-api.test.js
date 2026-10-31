// Unit tests for guest maps kept in browser storage (public/js/guest-api.js, ADR 0026).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'guest-api.js'));

function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
        size: () => items.size
    };
}

const lisbon = { lat: 38.72, lng: -9.14, type: 'visited', stay: 'visit', name: 'Lisbon, Portugal', category: 'City', notes: 'Pastéis', visits: [{ startDate: '2024-05-01', endDate: '2024-05-03' }] };

test('a guest map keeps places and visits in the API\'s shapes', async () => {
    const { createGuestApi, hasGuestMap, clearGuestMap, GUEST_USER } = await load();
    const storage = memoryStorage();
    const api = createGuestApi(storage, () => '2026-10-26T10:00:00.000Z');
    assert.equal(hasGuestMap(storage), false);
    assert.deepEqual(await api.currentUser(), GUEST_USER);

    const place = await api.addMarker(lisbon);
    assert.equal(hasGuestMap(storage), true);
    assert.equal(place.id, 1);
    assert.deepEqual([place.photoUrl, place.emoji, place.tags, place.travelDate], ['', '', [], '2024-05-01']);
    assert.deepEqual(place.visits, [{ id: 2, startDate: '2024-05-01', endDate: '2024-05-03', ongoing: false, notes: '', photoUrl: '', purpose: 'personal', organizationId: null }]);
    place.name = 'changed outside';
    assert.equal((await api.getMarkers())[0].name, 'Lisbon, Portugal', 'answers are copies');

    const visit = await api.addVisit(1, { startDate: '2025-01-02', ongoing: true });
    assert.equal(visit.ongoing, true);
    assert.equal((await api.getMarkers())[0].travelDate, '2025-01-02');
    assert.equal((await api.updateVisit(visit.id, { endDate: '2025-01-05' })).ongoing, false, 'an end date ends it');
    await api.deleteVisit(visit.id);
    assert.equal((await api.getMarkers())[0].visits.length, 1);
    const older = await api.addMarker({ ...lisbon, name: 'Porto, Portugal', visits: undefined, travelDate: '2019-03-01' });
    assert.equal(older.visits[0].startDate, '2019-03-01', 'an older file\'s travel date becomes a visit');

    const updated = await api.updateMarker(1, { ...place, name: 'Lisboa', rating: 5, visits: [] });
    assert.deepEqual([updated.name, updated.rating, updated.visits.length], ['Lisboa', 5, 1], 'place edits leave visits alone');

    const imported = await api.importMarkers([{ ...lisbon, name: 'Faro, Portugal' }]);
    assert.equal(imported.imported, 1);
    const bulk = await api.bulkMarkers({
        create: [{ ...lisbon, name: 'Spain', category: 'Country', visits: [] }],
        update: [{ id: 1, type: 'wishlist', stay: 'lived' }, { id: older.id, type: 'visited' }],
        remove: [imported.markers[0].id]
    });
    assert.deepEqual([bulk.updated[0].type, bulk.updated[0].stay, bulk.updated[1].stay], ['wishlist', 'visit', 'visit']);
    assert.deepEqual(bulk.removed, [imported.markers[0].id]);
    assert.equal(bulk.created[0].name, 'Spain');
    await api.deleteMarker(bulk.created[0].id);
    assert.deepEqual((await api.getMarkers()).map(marker => marker.name), ['Lisboa', 'Porto, Portugal']);

    await assert.rejects(api.updateMarker(99, lisbon), { status: 404 });
    await assert.rejects(api.deleteVisit(99), { status: 404 });
    clearGuestMap(storage);
    assert.equal(hasGuestMap(storage), false);
    assert.deepEqual(await api.getMarkers(), []);
});

test('a guest map keeps trips, the ledger\'s settings and the account settings', async () => {
    const { createGuestApi } = await load();
    const storage = memoryStorage();
    let clock = 0;
    const api = createGuestApi(storage, () => `2026-10-26T10:00:0${clock++}.000Z`);
    const someday = await api.createTrip({ title: 'Someday', destination: 'Japan', startDate: '', plan: [{ morning: '' }] });
    const dated = await api.createTrip({ title: 'Lisbon', destination: 'Lisbon', startDate: '2027-05-01', plan: [{ morning: 'Belém' }], extra: 'ignored' });
    assert.deepEqual([someday.startDate, someday.stops, someday.packing, someday.budget], ['', [], [], {}]);
    assert.equal(dated.extra, undefined);
    assert.deepEqual((await api.getTrips()).map(trip => trip.title), ['Lisbon', 'Someday'], 'newest dates first');
    const renamed = await api.updateTrip(dated.id, { ...dated, title: 'Lisboa', packing: [{ item: 'Hat', packed: false }] });
    assert.deepEqual([renamed.title, renamed.packing.length], ['Lisboa', 1]);
    await api.deleteTrip(someday.id);
    assert.equal((await api.getTrips()).length, 1);
    await assert.rejects(api.updateTrip(99, dated), { status: 404 });
    await assert.rejects(api.deleteTrip(99), { status: 404 });

    assert.deepEqual(await api.getLedger(), { dayRule: 'presence', rules: [], planned: [], exempt: [] });
    const settings = { dayRule: 'midnight', rules: [{ id: 'r1' }], planned: [], exempt: [{ id: 'e1' }], other: true };
    assert.deepEqual(await api.saveLedger(settings), { dayRule: 'midnight', rules: [{ id: 'r1' }], planned: [], exempt: [{ id: 'e1' }] });
    assert.deepEqual(await api.getVisitChanges(), []);

    const profile = await api.saveProfile({ homeCountry: 'PRT', mapPalette: 'print', profileVisibility: 'public' });
    assert.deepEqual([profile.homeCountry, profile.mapPalette, profile.profileVisibility], ['PRT', 'print', 'private'], 'a guest map is never public');
    assert.equal((await api.currentUser()).homeCountry, 'PRT');

    const archive = await api.exportAccount();
    assert.deepEqual([archive.format, archive.trips.length, archive.ledger.settings.dayRule, archive.profile.guest], ['travelmapster-account', 1, 'midnight', true]);
    for (const needs of ['changePassword', 'deleteAccount', 'geocodeCity', 'getPublicMap']) {
        await assert.rejects(api[needs]('x'), /Sign up to keep your map/);
    }
    assert.equal(await api.logout(), null);
});

test('storage that is full or broken is reported, and other versions start afresh', async () => {
    const { createGuestApi, hasGuestMap, clearGuestMap } = await load();
    const full = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    await assert.rejects(createGuestApi(full).addMarker(lisbon), /no room left/);
    const broken = { getItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    assert.equal(hasGuestMap(broken), false);
    clearGuestMap(broken);
    const old = memoryStorage();
    old.setItem('travelmapster.guest', JSON.stringify({ version: 0, markers: [{ id: 1 }] }));
    assert.deepEqual(await createGuestApi(old).getMarkers(), []);
});

test('a guest map merges two pins for one place as the API does', async () => {
    const { createGuestApi } = await load();
    const api = createGuestApi(memoryStorage(), () => '2026-10-26T10:00:00.000Z');
    const wish = await api.addMarker({ ...lisbon, type: 'wishlist', notes: 'Trams', visits: [] });
    const been = await api.addMarker({ ...lisbon, name: 'Lisboa, Portugal', tags: ['food'] });
    await assert.rejects(api.mergeMarkers(wish.id, wish.id), { status: 400 });
    await assert.rejects(api.mergeMarkers(wish.id, 99), { status: 404 });
    const merged = await api.mergeMarkers(wish.id, been.id);
    assert.deepEqual([merged.id, merged.type, merged.name, merged.notes, merged.tags, merged.visits.length, merged.travelDate],
        [wish.id, 'visited', 'Lisbon, Portugal', 'Trams\n\nPastéis', ['food'], 1, '2024-05-01']);
    assert.deepEqual((await api.getMarkers()).map(marker => marker.id), [wish.id]);
});
