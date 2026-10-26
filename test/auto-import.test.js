// Unit tests for visits found in photos and location history (public/js/exif.js, towns.js and
// auto-import.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

const { box, heic, jpeg } = require('./fixtures/photos');

test('photos tell where and when they were taken, in JPEG and HEIC files', async () => {
    const { photoMetadata } = await load('exif.js');
    const read = async buffer => photoMetadata(new Blob([buffer]));
    const lisbon = await read(jpeg({ date: '2024:05:12 18:03:00', lat: 38.7223, lng: -9.1393 }));
    assert.equal(lisbon.date, '2024-05-12');
    assert.ok(Math.abs(lisbon.lat - 38.7223) < 1e-4 && Math.abs(lisbon.lng + 9.1393) < 1e-4);
    const sydney = await read(heic({ date: '2023:01:02 09:00:00', lat: -33.8688, lng: 151.2093 }));
    assert.equal(sydney.date, '2023-01-02');
    assert.ok(Math.abs(sydney.lat + 33.8688) < 1e-4 && Math.abs(sydney.lng - 151.2093) < 1e-4);

    assert.deepEqual(await read(jpeg({ date: '2024:05:12 18:03:00' })), { lat: null, lng: null, date: '2024-05-12' });
    assert.deepEqual(await read(jpeg({ date: '0000:00:00 00:00:00', lat: 0, lng: 0 })), null, 'no fix and no date');
    // Big-endian ("MM") TIFF, with only the file's date in the first directory.
    const motorola = Buffer.alloc(8 + 2 + 12 + 4 + 20);
    motorola.write('MM', 0, 'latin1');
    motorola.writeUInt16BE(42, 2);
    motorola.writeUInt32BE(8, 4);
    motorola.writeUInt16BE(1, 8);
    motorola.writeUInt16BE(0x0132, 10);
    motorola.writeUInt16BE(2, 12);
    motorola.writeUInt32BE(20, 14);
    motorola.writeUInt32BE(26, 18);
    motorola.write('2022:12:31 23:59:59\0', 26, 'latin1');
    const { readTiff } = await load('exif.js');
    assert.deepEqual(readTiff(new DataView(motorola.buffer, motorola.byteOffset, motorola.length)), { lat: null, lng: null, date: '2022-12-31' });
    assert.equal(readTiff(new DataView(new ArrayBuffer(8))), null, 'not a TIFF block');
    assert.equal(await read(Buffer.from('not a photo at all')), null);
    assert.equal(await read(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0])), null, 'a JPEG without EXIF');
    assert.equal(await read(Buffer.concat([box('ftyp', Buffer.alloc(8)), box('mdat', Buffer.alloc(8))])), null, 'a HEIC without meta');
});

test('location history becomes stays, from Takeout and from the phone Timeline exports', async () => {
    const { timelineSightings, localDayOf } = await load('auto-import.js');
    const takeout = {
        timelineObjects: [
            { placeVisit: { location: { latitudeE7: 488566000, longitudeE7: 23522000 }, duration: { startTimestamp: '2019-04-03T22:30:00Z', endTimestamp: '2019-04-05T08:00:00Z' } } },
            { activitySegment: { startLocation: { latitudeE7: 1, longitudeE7: 1 } } },
            { placeVisit: { location: { latitudeE7: 356762000, longitudeE7: 1396503000 }, duration: { startTimestampMs: '1554850800000' } } },
            { placeVisit: { location: {}, duration: { startTimestamp: '2019-04-03T10:00:00Z' } } }
        ]
    };
    assert.deepEqual(timelineSightings(takeout), [
        { lat: 48.8566, lng: 2.3522, startDate: '2019-04-03', endDate: '2019-04-05' },
        { lat: 35.6762, lng: 139.6503, startDate: '2019-04-10', endDate: '2019-04-10' }
    ]);
    const android = { semanticSegments: [
        { startTime: '2024-05-01T23:00:00.000+02:00', endTime: '2024-05-02T10:00:00.000+02:00', visit: { topCandidate: { placeLocation: { latLng: '41.3874°, 2.1686°' } } } },
        { startTime: '2024-05-02T10:00:00.000+02:00', timelinePath: [{ point: '41.0°, 2.0°' }] }
    ] };
    assert.deepEqual(timelineSightings(android), [{ lat: 41.3874, lng: 2.1686, startDate: '2024-05-01', endDate: '2024-05-02' }]);
    const ios = [
        { startTime: '2024-06-01T08:00:00.000-04:00', endTime: '2024-06-01T09:00:00.000-04:00', visit: { topCandidate: { placeLocation: 'geo:40.712800,-74.006000' } } },
        { startTime: '2024-06-01T09:00:00.000-04:00', activity: { start: 'geo:40.7,-74.0' } },
        { startTime: 'not a time', visit: { topCandidate: { placeLocation: 'geo:40.7,-74.0' } } },
        { startTime: '2024-06-02T08:00:00Z', visit: { topCandidate: { placeLocation: 'geo:95,0' } } }
    ];
    assert.deepEqual(timelineSightings(ios), [{ lat: 40.7128, lng: -74.006, startDate: '2024-06-01', endDate: '2024-06-01' }]);
    assert.deepEqual(timelineSightings({ something: 'else' }), []);
    assert.deepEqual(timelineSightings(null), []);
    // UTC shifted by the longitude: 02:00 UTC is still the day before in New York.
    assert.equal(localDayOf('2024-06-02T02:00:00Z', -74), '2024-06-01');
    assert.equal(localDayOf('2024-06-02', -150), '2024-06-02', 'a day stays as it is');
    assert.equal(localDayOf('', 0), null);
});

test('sightings become towns with stays; positions are never kept', async () => {
    const { placesFromSightings, daysToStays, VISITS_PER_PLACE } = await load('auto-import.js');
    const { createTownFinder } = await load('towns.js');
    const cities = [
        { name: 'Paris', countryId: 'FRA', population: 2_100_000, lat: 48.857, lng: 2.352 },
        { name: 'Boulogne-Billancourt', countryId: 'FRA', population: 120_000, lat: 48.835, lng: 2.241 },
        { name: 'Chartres', countryId: 'FRA', population: 38_000, lat: 48.446, lng: 1.489 }
    ];
    const loaded = [];
    const townNear = createTownFinder({
        cities,
        tiles: [{ id: 't1', bounds: [40, -10, 50, 10] }, { id: 't2', bounds: [-50, 100, -30, 160] }],
        loadTile: async id => {
            loaded.push(id);
            return [['Maintenon', 'FRA', 0, 4_400, 8, 48.587, 1.578], ['Paris', 'FRA', 1, 2_100_000, 3, 48.857, 2.352]];
        }
    });
    assert.equal((await townNear(48.84, 2.25)).name, 'Paris', 'the largest town within 10 km');
    assert.equal((await townNear(48.6, 1.6)).name, 'Maintenon', 'else the nearest, from a tile');
    assert.equal(await townNear(46.0, -5.5), null, 'nothing within 30 km');
    assert.deepEqual(loaded, ['t1'], 'tiles load once, only around the points');

    const countries = { FRA: { name: 'France', label: [46.7, 2.5] }, ESP: { name: 'Spain', label: [40.2, -3.6] } };
    const places = await placesFromSightings([
        { lat: 48.85, lng: 2.35, startDate: '2024-05-12', endDate: '2024-05-12' },
        { lat: 48.86, lng: 2.34, startDate: '2024-05-14', endDate: '2024-05-14' },
        { lat: 48.851, lng: 2.349, startDate: '2024-06-01', endDate: '2024-06-03' },
        { lat: 40.0, lng: -4.0, startDate: '2023-01-01', endDate: '2023-01-01' },
        { lat: 0, lng: -30, startDate: '2023-01-01', endDate: '2023-01-01' }
    ], {
        townNear: async (lat, lng) => (lat > 45 ? townNear(lat, lng) : null),
        countryAt: lat => (lat === 40 ? { ...countries.ESP } : null),
        countryById: id => countries[id],
        source: 'From photos'
    });
    assert.deepEqual(places.map(place => [place.name, place.category, place.lat, place.lng]), [
        ['Spain', 'Country', 40.2, -3.6],
        ['Paris, France', 'City', 48.857, 2.352]
    ]);
    assert.deepEqual(places[1].visits.map(({ startDate, endDate }) => [startDate, endDate]), [['2024-05-12', '2024-05-14'], ['2024-06-01', '2024-06-03']]);
    assert.deepEqual(places[1].visits[0], { startDate: '2024-05-12', endDate: '2024-05-14', notes: 'From photos', photoUrl: '', ongoing: false });
    assert.equal(places[1].type, 'visited');

    assert.deepEqual(daysToStays(['2024-01-05', '2024-01-01', '2024-01-03', '2024-01-01', '2024-01-09']), [
        { startDate: '2024-01-01', endDate: '2024-01-05' }, { startDate: '2024-01-09', endDate: '2024-01-09' }
    ]);
    const many = Array.from({ length: VISITS_PER_PLACE + 5 }, (_, i) => ({ lat: 48.85, lng: 2.35, startDate: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, endDate: '' }));
    const capped = await placesFromSightings(many.map(s => ({ ...s, endDate: s.startDate })), {
        townNear, countryAt: () => null, countryById: id => countries[id], source: ''
    });
    assert.equal(capped[0].visits.length, VISITS_PER_PLACE);
    assert.equal(capped[0].visits.at(-1).startDate, '2042-01-01', 'the latest are kept');
});
