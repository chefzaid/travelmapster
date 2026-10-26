// Unit tests for the account archive, the ZIP writer and the GeoJSON and KML exports
// (public/js/archive.js, public/js/zip.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

// Reads a stored (uncompressed) ZIP through its central directory, checking every entry.
function readZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054b50);
    const count = view.getUint16(end + 10, true);
    let position = view.getUint32(end + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i += 1) {
        assert.equal(view.getUint32(position, true), 0x02014b50);
        assert.equal(view.getUint16(position + 8, true) & 0x0800, 0x0800, 'names are flagged as UTF-8');
        const crc = view.getUint32(position + 16, true);
        const size = view.getUint32(position + 24, true);
        const nameLength = view.getUint16(position + 28, true);
        const offset = view.getUint32(position + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
        assert.equal(view.getUint32(offset, true), 0x04034b50);
        const localNameLength = view.getUint16(offset + 26, true);
        const data = bytes.subarray(offset + 30 + localNameLength, offset + 30 + localNameLength + size);
        assert.equal(zlib.crc32(data), crc, `${name} has a matching CRC-32`);
        entries.set(name, new TextDecoder().decode(data));
        position += 46 + nameLength;
    }
    return entries;
}

test('the ZIP writer stores files that any reader can check', async () => {
    const { zip, crc32 } = await load('zip.js');
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    const bytes = zip([{ name: 'a.txt', content: 'hello' }, { name: 'été/ß.json', content: '{"ok":true}' }, { name: 'empty', content: '' }],
        new Date('2026-10-26T13:45:30Z'));
    const entries = readZip(bytes);
    assert.deepEqual([...entries.keys()], ['a.txt', 'été/ß.json', 'empty']);
    assert.equal(entries.get('été/ß.json'), '{"ok":true}');
    assert.equal(entries.get('empty'), '');
    // DOS date and time of each entry.
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint16(10, true), (13 << 11) | (45 << 5) | 15);
    assert.equal(view.getUint16(12, true), (46 << 9) | (10 << 5) | 26);
    assert.equal(readZip(zip([])).size, 0);
});

const markers = [
    {
        id: 1, name: 'Lisbon, Portugal', category: 'City', lat: 38.72, lng: -9.14, type: 'visited', stay: 'visit',
        rating: 5, tags: ['food'], emoji: '🐟', notes: 'Fado & <pastéis>', photoUrl: null,
        visits: [{ startDate: '2023-05-01', endDate: '2023-05-04', notes: 'First' }, { startDate: '2025-01-01', endDate: null, ongoing: true }]
    },
    { id: 2, name: 'Japan', category: 'Country', lat: 36.5, lng: 138, type: 'wishlist', stay: 'visit', visits: [] }
];

test('places become GeoJSON points with their details', async () => {
    const { buildGeoJson } = await load('archive.js');
    const geojson = JSON.parse(buildGeoJson(markers));
    assert.equal(geojson.type, 'FeatureCollection');
    assert.deepEqual(geojson.features[0].geometry, { type: 'Point', coordinates: [-9.14, 38.72] });
    assert.equal(geojson.features[0].properties.status, 'visited');
    assert.equal(geojson.features[1].properties.status, 'wishlist');
    assert.deepEqual(geojson.features[0].properties.visits.map(visit => visit.startDate), ['2025-01-01', '2023-05-01']);
    assert.equal(geojson.features[0].properties.photoUrl, '');
});

test('places become KML placemarks, escaped', async () => {
    const { buildKml } = await load('archive.js');
    const kml = buildKml(markers, 'Ana & co');
    assert.ok(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">'));
    assert.ok(kml.includes('<name>Ana &amp; co</name>'));
    assert.equal(kml.match(/<Placemark>/g).length, 2);
    assert.ok(kml.includes('<coordinates>-9.14,38.72,0</coordinates>'));
    assert.ok(kml.includes('Been there\nVisits: 2025-01-01 – still there; 2023-05-01 – 2023-05-04\nFado &amp; &lt;pastéis&gt;'));
    assert.ok(kml.includes('<description>Wishlist</description>'));
    assert.ok(!kml.includes('<pastéis>'));
});

test('the account archive holds the export and the places in every format', async () => {
    const { accountArchive } = await load('archive.js');
    const data = { format: 'travelmapster-account', version: 1, profile: { username: 'ana' }, places: markers, trips: [], ledger: { settings: {}, changes: [] } };
    const entries = readZip(accountArchive(data));
    assert.deepEqual([...entries.keys()], ['README.txt', 'account.json', 'places.csv', 'places.geojson', 'places.kml']);
    assert.deepEqual(JSON.parse(entries.get('account.json')), data);
    assert.ok(entries.get('places.csv').startsWith('"id","lat","lng"'));
    assert.equal(entries.get('places.csv').split('\r\n').length, 1 + 2 + 1, 'a row per visit, and one for a place without');
    assert.equal(JSON.parse(entries.get('places.geojson')).features.length, 2);
    assert.ok(entries.get('places.kml').includes('<name>ana&apos;s places</name>'));
    assert.equal(readZip(accountArchive({ profile: {} })).get('places.csv').split('\r\n').length, 1);
});
