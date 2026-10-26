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
