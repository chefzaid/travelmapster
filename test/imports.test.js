// Unit tests for importing from other travel apps (public/js/imports.js, public/js/zip-read.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const publicDir = path.join(__dirname, '..', 'public');
const load = file => import(path.join(publicDir, 'js', file));

// Seconds for a local day and hour, as Polarsteps stores times.
const at = (day, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime() / 1000;

const trip = {
    name: 'Portugal by train',
    start_date: at('2024-05-01', 8),
    end_date: at('2024-05-09', 20),
    all_steps: [
        { name: 'Porto', start_time: at('2024-05-04'), location: { lat: 41.1496, lon: -8.6109, name: 'Porto', detail: 'Portugal' } },
        { name: 'Lisbon', start_time: at('2024-05-01', 9), location: { lat: 38.7223, lon: -9.1393, name: 'Lisbon', detail: 'Portugal' } },
        { name: 'Back in Lisbon', start_time: at('2024-05-07'), location: { lat: 38.71, lon: -9.14, name: 'Lisbon', detail: 'Portugal' } },
        { name: 'No place', start_time: at('2024-05-02'), location: { lat: 'x', lon: 0, name: 'Nowhere' } },
        { name: 'No time', location: { lat: 1, lon: 1, name: 'Somewhere' } }
    ]
};

test('Polarsteps steps become places with a visit each, until the next step or the end of the trip', async () => {
    const { polarstepsPlaces } = await load('imports.js');
    const places = polarstepsPlaces(trip);
    assert.deepEqual(places.map(place => [place.name, place.category, place.lat, place.lng]), [
        ['Lisbon, Portugal', 'City', 38.722, -9.139], ['Porto, Portugal', 'City', 41.15, -8.611]
    ]);
    assert.deepEqual(places[0].visits.map(visit => [visit.startDate, visit.endDate]), [['2024-05-01', '2024-05-04'], ['2024-05-07', '2024-05-09']]);
    assert.deepEqual(places[1].visits.map(visit => [visit.startDate, visit.endDate]), [['2024-05-04', '2024-05-07']]);
    assert.equal(places[0].visits[0].notes, 'Polarsteps: Portugal by train');
    assert.deepEqual(polarstepsPlaces({}), []);
    assert.deepEqual(polarstepsPlaces({ all_steps: [{ start_time: at('2024-01-01'), location: { lat: 1, lon: 2, name: 'Solo' } }] })
        .map(place => [place.name, place.visits[0].endDate]), [['Solo', '2024-01-01']]);
});

test('a pasted country list becomes countries, with the names the map does not know apart', async () => {
    const { createCountryIndex } = await load('geo.js');
    const { countryListPlaces } = await load('imports.js');
    const index = createCountryIndex(JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'countries.geojson'), 'utf8')));
    const { places, unknown } = countryListPlaces('1. France\n• Japan, portugal; Atlantis\n\nFrance\n- United States', index);
    assert.deepEqual(places.map(place => place.name), ['France', 'Japan', 'Portugal', 'United States of America']);
    assert.ok(places.every(place => place.category === 'Country' && place.type === 'visited' && Number.isFinite(place.lat)));
    assert.deepEqual(unknown, ['Atlantis']);
    assert.deepEqual(countryListPlaces('', index), { places: [], unknown: [] });
});

test('ZIP entries are read one by one, stored or deflated, and trip files are found', async () => {
    const { zipEntries, readZipText } = await load('zip-read.js');
    const { polarstepsTripEntries } = await load('imports.js');
    const { zip } = await load('zip.js');
    // A stored archive from the app's own writer, and a deflated entry patched in by hand.
    const stored = zip([
        { name: 'user/user.json', content: '{}' },
        { name: 'trip/portugal_123/trip.json', content: JSON.stringify(trip) },
        { name: 'trip/portugal_123/photos/a.jpg', content: 'jpeg' }
    ]);
    const blob = new Blob([stored]);
    const entries = await zipEntries(blob);
    assert.deepEqual(entries.map(entry => entry.name), ['user/user.json', 'trip/portugal_123/trip.json', 'trip/portugal_123/photos/a.jpg']);
    const trips = polarstepsTripEntries(entries);
    assert.deepEqual(trips.map(entry => entry.name), ['trip/portugal_123/trip.json']);
    assert.deepEqual(JSON.parse(await readZipText(blob, trips[0])), trip);

    const text = 'deflated '.repeat(50);
    const deflated = zlib.deflateRawSync(text);
    const name = Buffer.from('trip/a_1/trip.json');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(text.length, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + deflated.length, 16);
    const archive = new Blob([local, name, deflated, central, name, end]);
    const [entry] = await zipEntries(archive);
    assert.equal(await readZipText(archive, entry), text);

    await assert.rejects(zipEntries(new Blob(['not a zip at all'])), /not a ZIP/);
});
