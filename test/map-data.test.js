// The Brotli copies of the map data (scripts/compress-map-data.js) match their sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { dataFiles } = require('../scripts/compress-map-data');

const publicDir = path.join(__dirname, '..', 'public');

test('every map data file has an up-to-date Brotli copy (run scripts/compress-map-data.js after a change)', () => {
    const files = dataFiles();
    assert.ok(files.length > 50);
    for (const file of files) {
        const name = path.relative(publicDir, file);
        assert.ok(fs.existsSync(`${file}.br`), `${name} has a .br copy`);
        assert.ok(zlib.brotliDecompressSync(fs.readFileSync(`${file}.br`)).equals(fs.readFileSync(file)), `${name}.br is up to date`);
    }
});

test('overseas territories drawn on their own have their towns (GeoNames files them under their own codes)', () => {
    const dataDir = path.join(publicDir, 'data');
    const countryIds = new Set(JSON.parse(fs.readFileSync(path.join(dataDir, 'cities.json'), 'utf8')).map(city => city.countryId));
    for (const file of fs.readdirSync(path.join(dataDir, 'cities')).filter(name => name.endsWith('.json'))) {
        // Tiles hold compact rows: [name, countryId, capital, population, minZoom, lat, lng].
        for (const row of JSON.parse(fs.readFileSync(path.join(dataDir, 'cities', file), 'utf8'))) countryIds.add(row[1]);
    }
    for (const id of ['GUF', 'GLP', 'MTQ', 'REU', 'MYT', 'SJM', 'BES']) assert.ok(countryIds.has(id), `${id} has towns`);
});
