'use strict';

// Link preview pictures of shared maps: every country filled in its colour, drawn as a PNG
// without a graphics library. Countries are filled at twice the size with a scanline rule,
// outlined where neighbouring pixels belong to different countries or the sea, then averaged
// down for smooth edges. The country layout is drawn once; each picture only paints it.
const zlib = require('node:zlib');

const SCALE = 2;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function rgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [value >> 16, (value >> 8) & 255, value & 255];
}

/**
 * Pixel rows crossed by a polygon's edges, with the x of each crossing at the row's centre.
 * Rings are in pixels; holes come out because crossings pair up (even-odd rule).
 */
function crossings(polygon, height) {
    const rows = new Map();
    for (const ring of polygon) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [x1, y1] = ring[j];
            const [x2, y2] = ring[i];
            if (y1 === y2) continue;
            const first = Math.max(0, Math.ceil(Math.min(y1, y2) - 0.5));
            const last = Math.min(height - 1, Math.ceil(Math.max(y1, y2) - 0.5) - 1);
            for (let y = first; y <= last; y++) {
                const x = x1 + ((y + 0.5 - y1) * (x2 - x1)) / (y2 - y1);
                const row = rows.get(y);
                if (row) row.push(x);
                else rows.set(y, [x]);
            }
        }
    }
    return rows;
}

/** Each pixel's country, as its position in the list plus one (0 is the sea). */
function rasterize(shapes, width, height) {
    const ids = new Uint16Array(width * height);
    shapes.forEach((polygons, n) => {
        for (const polygon of polygons) {
            for (const [y, xs] of crossings(polygon, height)) {
                xs.sort((a, b) => a - b);
                for (let k = 0; k + 1 < xs.length; k += 2) {
                    const from = Math.max(0, Math.ceil(xs[k] - 0.5));
                    const to = Math.min(width, Math.ceil(xs[k + 1] - 0.5));
                    if (to > from) ids.fill(n + 1, y * width + from, y * width + to);
                }
            }
        }
    });
    return ids;
}

/** Pixels next to a pixel of another country (or the sea): the outlines. */
function outlines(ids, width, height) {
    const edges = new Uint8Array(ids.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const id = ids[i];
            edges[i] = Number((x > 0 && ids[i - 1] !== id) || (x + 1 < width && ids[i + 1] !== id)
                || (y > 0 && ids[i - width] !== id) || (y + 1 < height && ids[i + width] !== id));
        }
    }
    return edges;
}

function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(type)), 0);
    return Buffer.concat([head, data, crc]);
}

/** An 8-bit RGB PNG from `width × height × 3` bytes. */
function encodePng(width, height, pixels) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const stride = width * 3;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A map of these GeoJSON country features, projected by `project` ([lng, lat] to [x, y] with y
 * up) and fitted in a picture of the given size. `render(fillOf)` paints it: `fillOf(feature)`
 * gives each country's "#rrggbb" colour.
 */
function createMapImage(features, project, { width = 1200, height = 630, margin = 24, background = '#bfe6f5', border = '#1f3b57' } = {}) {
    const projected = features.map(feature => {
        const { type, coordinates } = feature.geometry;
        return (type === 'Polygon' ? [coordinates] : coordinates).map(polygon => polygon.map(ring => ring.map(project)));
    });
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of projected.flat(3)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const scale = Math.min((width - 2 * margin) / (maxX - minX), (height - 2 * margin) / (maxY - minY)) * SCALE;
    const left = (width * SCALE - (maxX - minX) * scale) / 2;
    const top = (height * SCALE - (maxY - minY) * scale) / 2;
    const shapes = projected.map(polygons => polygons.map(polygon =>
        polygon.map(ring => ring.map(([x, y]) => [left + (x - minX) * scale, top + (maxY - y) * scale]))));
    const bigWidth = width * SCALE;
    const bigHeight = height * SCALE;
    const ids = rasterize(shapes, bigWidth, bigHeight);
    const edges = outlines(ids, bigWidth, bigHeight);
    const sea = rgb(background);
    const ink = rgb(border);

    return {
        width,
        height,
        features,
        /** The PNG, with each country in `fillOf(feature)`. */
        render(fillOf) {
            const fills = [sea, ...features.map(feature => rgb(fillOf(feature)))];
            const pixels = Buffer.alloc(width * height * 3);
            const samples = SCALE * SCALE;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let r = 0;
                    let g = 0;
                    let b = 0;
                    for (let dy = 0; dy < SCALE; dy++) {
                        for (let dx = 0; dx < SCALE; dx++) {
                            const i = (y * SCALE + dy) * bigWidth + x * SCALE + dx;
                            const color = edges[i] ? ink : fills[ids[i]];
                            r += color[0];
                            g += color[1];
                            b += color[2];
                        }
                    }
                    const o = (y * width + x) * 3;
                    pixels[o] = Math.round(r / samples);
                    pixels[o + 1] = Math.round(g / samples);
                    pixels[o + 2] = Math.round(b / samples);
                }
            }
            return encodePng(width, height, pixels);
        }
    };
}

module.exports = { createMapImage, encodePng };
