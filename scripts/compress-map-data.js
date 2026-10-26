#!/usr/bin/env node
// Writes a Brotli copy (<file>.br, best quality) beside every map data file in public/data,
// which the server sends to browsers that accept it. build-map-data.js runs it after writing
// the data; run it alone after changing a data file by hand:
//
//   node scripts/compress-map-data.js

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

function dataFiles(dir = DATA_DIR) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return dataFiles(file);
        return /\.(json|geojson)$/.test(entry.name) ? [file] : [];
    });
}

function compress(file) {
    return zlib.brotliCompressSync(fs.readFileSync(file), {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT }
    });
}

function compressMapData() {
    let raw = 0;
    let packed = 0;
    for (const file of dataFiles()) {
        const brotli = compress(file);
        fs.writeFileSync(`${file}.br`, brotli);
        raw += fs.statSync(file).size;
        packed += brotli.length;
    }
    console.log(`Compressed ${(raw / 1e6).toFixed(1)} MB of map data to ${(packed / 1e6).toFixed(1)} MB with Brotli`);
}

if (require.main === module) compressMapData();

module.exports = { compressMapData, dataFiles };
