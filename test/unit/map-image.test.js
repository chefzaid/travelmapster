'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createMapImage, encodePng } = require('../../src/map-image');

/** The PNG's size and its pixels as [r, g, b] by row, read back from its single IDAT chunk. */
function decode(png) {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const idatLength = png.readUInt32BE(33);
    assert.equal(png.toString('latin1', 37, 41), 'IDAT');
    const raw = zlib.inflateSync(png.subarray(41, 41 + idatLength));
    const pixel = (x, y) => [...raw.subarray(y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3)];
    return { width, height, pixel };
}

const square = (id, x0, y0, size) => ({
    properties: { id },
    geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]]] }
});

test('PNG chunks carry valid checksums', () => {
    const png = encodePng(1, 1, Buffer.from([255, 0, 0]));
    assert.equal(png.toString('latin1', 12, 16), 'IHDR');
    const crc = png.readUInt32BE(29);
    assert.equal(crc, zlib.crc32(png.subarray(12, 29)));
    assert.equal(png.toString('latin1', png.length - 8, png.length - 4), 'IEND');
    assert.deepEqual(decode(png).pixel(0, 0), [255, 0, 0]);
});

test('countries are filled in their colours and outlined, with holes left as sea', () => {
    const donut = {
        properties: { id: 'DON' },
        geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [60, 0], [60, 60], [0, 60], [0, 0]], [[20, 20], [40, 20], [40, 40], [20, 40], [20, 20]]]] }
    };
    const map = createMapImage([donut, square('SQR', 80, 0, 20)], point => point, { width: 100, height: 60, margin: 0, background: '#0000ff', border: '#000000' });
    const png = map.render(feature => (feature.properties.id === 'DON' ? '#ff0000' : '#00ff00'));
    const { width, height, pixel } = decode(png);
    assert.equal(width, 100);
    assert.equal(height, 60);
    // y grows upwards in map units, so the square (y 0 to 20) sits at the bottom right.
    assert.deepEqual(pixel(10, 30), [255, 0, 0]);
    assert.deepEqual(pixel(30, 30), [0, 0, 255], 'the hole is sea');
    assert.deepEqual(pixel(90, 50), [0, 255, 0]);
    assert.deepEqual(pixel(90, 10), [0, 0, 255]);
    assert.deepEqual(pixel(70, 30), [0, 0, 255]);
    // Outlines darken the edge pixels.
    assert.ok(pixel(60, 30).every(channel => channel < 255));
    assert.ok(pixel(80, 50)[1] < 255);
    assert.equal(map.features.length, 2);
});
