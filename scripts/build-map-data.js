#!/usr/bin/env node
// Builds the compact map data served from public/data.
//
// Usage:
//   node scripts/build-map-data.js <source-dir>
//
// The directory must contain, from Natural Earth (public domain,
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson):
//   ne_50m_admin_0_countries.geojson, ne_10m_populated_places_simple.geojson
// and from GeoNames (CC BY 4.0, https://download.geonames.org/export/dump/):
//   cities500.txt (unzipped)

const fs = require('node:fs');
const path = require('node:path');

const sourceDir = process.argv[2];
if (!sourceDir) {
    console.error('Usage: node scripts/build-map-data.js <source-dir>');
    process.exit(1);
}

const outputDir = path.join(__dirname, '..', 'public', 'data');
const PRECISION = 3; // ~100 m
const TOLERANCE = 0.02; // degrees; friendly, cartoon coastlines that still hold at street-level zooms
// Every GeoNames place of 500+ people gets the first zoom (in half steps) at which its
// dot and name fit beside the places already shown, so each zoom step adds more.
const MAX_MAP_ZOOM = 11;
const BASE_MAX_ZOOM = 6; // cities.json: loaded up front; the rest is tiled by region
const TILE_MAX_CITIES = 4000;
// Sections of cities, and historical, abandoned or destroyed places are not towns to visit.
const EXCLUDED_FEATURE_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
// Natural Earth marks Taiwan as CN-TW; GeoNames uses TW.
const ISO2_OVERRIDES = { TW: 'TWN' };

function readGeoJson(fileName) {
    return JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), 'utf8'));
}

function round(value) {
    const factor = 10 ** PRECISION;
    return Math.round(value * factor) / factor;
}

function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
    return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

// Ramer-Douglas-Peucker line simplification.
function douglasPeucker(points) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [start, end] = stack.pop();
        let maxDistance = 0;
        let index = -1;
        for (let i = start + 1; i < end; i += 1) {
            const distance = perpendicularDistance(points[i], points[start], points[end]);
            if (distance > maxDistance) {
                maxDistance = distance;
                index = i;
            }
        }
        if (maxDistance > TOLERANCE) {
            keep[index] = 1;
            stack.push([start, index], [index, end]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

function roundRing(ring) {
    const result = [];
    for (const [lng, lat] of ring) {
        const point = [round(lng), round(lat)];
        const previous = result[result.length - 1];
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
            result.push(point);
        }
    }
    return result;
}

// Tiny islands collapse under simplification, so keep their original outline.
function simplifyRing(ring) {
    const simplified = roundRing(douglasPeucker(ring));
    if (simplified.length >= 4) return simplified;
    const rounded = roundRing(ring);
    return rounded.length >= 4 ? rounded : null;
}

function simplifyGeometry(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const simplified = polygons
        .map(polygon => polygon.map(simplifyRing).filter(Boolean))
        .filter(polygon => polygon.length > 0);
    return simplified.length === 1
        ? { type: 'Polygon', coordinates: simplified[0] }
        : { type: 'MultiPolygon', coordinates: simplified };
}

function isoCode(properties) {
    const code = properties.ISO_A2 !== '-99' ? properties.ISO_A2 : properties.ISO_A2_EH;
    return code && code !== '-99' ? code : '';
}

function uniqueNames(...names) {
    return [...new Set(names.filter(name => typeof name === 'string' && name.trim()))];
}

const countriesSource = readGeoJson('ne_50m_admin_0_countries.geojson');
const countries = {
    type: 'FeatureCollection',
    features: countriesSource.features
        .filter(feature => feature.properties.CONTINENT !== 'Antarctica')
        .map(feature => {
            const p = feature.properties;
            return {
                type: 'Feature',
                properties: {
                    id: p.ADM0_A3,
                    name: p.NAME,
                    iso2: isoCode(p),
                    continent: p.CONTINENT === 'Seven seas (open ocean)' ? 'Oceania' : p.CONTINENT,
                    subregion: p.SUBREGION,
                    population: p.POP_EST,
                    color: p.MAPCOLOR7,
                    labelZoom: p.MIN_LABEL,
                    label: [round(p.LABEL_Y), round(p.LABEL_X)],
                    aliases: uniqueNames(p.NAME_LONG, p.ADMIN, p.NAME_EN, p.FORMAL_EN, p.NAME_SORT, p.NAME_CIAWF, p.GEOUNIT, p.SUBUNIT)
                        .filter(name => name !== p.NAME)
                },
                geometry: simplifyGeometry(feature.geometry)
            };
        })
        .sort((first, second) => first.properties.name.localeCompare(second.properties.name))
};

// --- cities -------------------------------------------------------------------

const countryByIso2 = new Map(countries.features.map(f => [f.properties.iso2, f.properties]).filter(([code]) => code));
for (const [code, id] of Object.entries(ISO2_OVERRIDES)) {
    countryByIso2.set(code, countries.features.find(f => f.properties.id === id).properties);
}

// Natural Earth's curated label zoom ranks the well-known cities ahead of raw population.
const naturalEarth = readGeoJson('ne_10m_populated_places_simple.geojson').features.map(f => f.properties);
const neIndex = new Map();
for (const p of naturalEarth) {
    const key = `${p.adm0_a3}|${normalize(p.name)}`;
    if (!neIndex.has(key)) neIndex.set(key, []);
    neIndex.get(key).push(p);
}

function normalize(name) {
    return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function naturalEarthPlace(name, asciiName, countryId, lat, lng) {
    for (const candidate of [name, asciiName]) {
        const match = (neIndex.get(`${countryId}|${normalize(candidate)}`) || [])
            .find(p => Math.abs(p.latitude - lat) < 0.5 && Math.abs(p.longitude - lng) < 0.5);
        if (match) return match;
    }
    return null;
}

// Other towns start appearing by size, so each zoom step adds the next tier.
function populationZoom(population) {
    const tiers = [[1e6, 4], [3e5, 4.5], [1e5, 5], [5e4, 5.5], [2e4, 6], [1e4, 6.5], [5e3, 7], [2e3, 7.5]];
    return tiers.find(([minimum]) => population >= minimum)?.[1] ?? 8;
}

const FEATURE_RANK = { PPLC: 0, PPLA: 1, PPLG: 1, PPLA2: 2, PPLA3: 3, PPLA4: 4, PPLA5: 5 };
const places = [];
for (const line of fs.readFileSync(path.join(sourceDir, 'cities500.txt'), 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 15 || EXCLUDED_FEATURE_CODES.has(f[7])) continue;
    const country = countryByIso2.get(f[8]);
    if (!country) continue;
    const lat = Number(f[4]);
    const lng = Number(f[5]);
    const population = Number(f[14]) || 0;
    const match = naturalEarthPlace(f[1], f[2], country.id, lat, lng);
    const ne = match ? match.min_zoom : null;
    // GeoNames marks sovereign capitals; Natural Earth also marks territory capitals.
    const capital = f[7] === 'PPLC' || match?.featurecla.startsWith('Admin-0 capital') ? 1 : 0;
    places.push({
        name: f[1], country: country.name, countryId: country.id, capital, population,
        lat: round(lat), lng: round(lng),
        // Earliest zoom a place may appear: capitals and curated cities first, other towns later.
        earliest: capital ? (population >= 5e6 ? 3 : 4) : ne !== null ? Math.max(3, ne - 0.5) : populationZoom(population),
        priority: [capital ? 0 : 1, ne ?? 99, -population, FEATURE_RANK[f[7]] ?? 6]
    });
}

// Districts listed as towns ("Brno střed", "Brno-sever") wait until the city itself has
// its label, so they never crowd it out.
const byFirstWord = new Map();
for (const place of places) {
    const key = `${place.countryId}|${normalize(place.name).split(/[\s-]/)[0]}`;
    (byFirstWord.get(key) || byFirstWord.set(key, []).get(key)).push(place);
}
for (const place of places) {
    const name = normalize(place.name);
    const city = (byFirstWord.get(`${place.countryId}|${name.split(/[\s-]/)[0]}`) || []).find(other => other !== place
        && other.population > place.population && name.startsWith(`${normalize(other.name)} `.slice(0, -1))
        && name.length > normalize(other.name).length && /[\s-]/.test(name[normalize(other.name).length])
        && Math.abs(other.lat - place.lat) < 0.3 && Math.abs(other.lng - place.lng) < 0.3);
    if (city) place.earliest = Math.max(place.earliest, 9);
}

// Mercator pixel position at a zoom, matching Leaflet's projection.
function project(lat, lng, zoom) {
    const scale = 256 * 2 ** zoom;
    const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

// The boxes the browser tries for a dot with its name: on the right, then on the left.
function labelBoxes(place, zoom) {
    const [x, y] = project(place.lat, place.lng, zoom);
    const width = place.name.length * 7 + 6;
    return [[x - 8, y - 9, x + 10 + width, y + 9], [x - 10 - width, y - 9, x + 8, y + 9]];
}

function createGrid(cell = 128) {
    const cells = new Map();
    const keys = ([x1, y1, x2, y2], visit) => {
        for (let cx = Math.floor(x1 / cell); cx <= Math.floor(x2 / cell); cx++) {
            for (let cy = Math.floor(y1 / cell); cy <= Math.floor(y2 / cell); cy++) visit(`${cx},${cy}`);
        }
    };
    return {
        claim(box) {
            let free = true;
            keys(box, key => {
                if (free) free = !(cells.get(key) || []).some(([a1, b1, a2, b2]) => box[0] < a2 && box[2] > a1 && box[1] < b2 && box[3] > b1);
            });
            if (free) keys(box, key => (cells.get(key) || cells.set(key, []).get(key)).push(box));
            return free;
        }
    };
}

const compare = (a, b) => a.priority.reduce((result, value, i) => result || value - b.priority[i], 0);
places.sort(compare);
for (let zoom = 3; zoom <= MAX_MAP_ZOOM; zoom += 0.5) {
    // Places shown at a lower zoom keep their room; new ones fill the space around them.
    const order = places.filter(p => p.minZoom !== undefined)
        .sort((a, b) => a.minZoom - b.minZoom || compare(a, b))
        .concat(places.filter(p => p.minZoom === undefined && p.earliest <= zoom));
    const grid = createGrid();
    for (const place of order) {
        if (labelBoxes(place, zoom).some(box => grid.claim(box)) && place.minZoom === undefined) place.minZoom = zoom;
    }
}

// Places that never find room for a name still appear as a dot at the deepest zoom.
const cities = places.map(({ name, country, countryId, capital, population, lat, lng, minZoom }) => (
    { name, country, countryId, capital, population, minZoom: minZoom ?? MAX_MAP_ZOOM + 0.5, lat, lng }));

// Split everything above the base zoom into a quadtree of region tiles.
const tiles = [];
function split(list, [south, west, north, east], id) {
    if (list.length <= TILE_MAX_CITIES || north - south < 0.5) {
        if (list.length) tiles.push({ id, bounds: [south, west, north, east], list });
        return;
    }
    const midLat = (south + north) / 2;
    const midLng = (west + east) / 2;
    const quads = [[south, west, midLat, midLng], [south, midLng, midLat, east], [midLat, west, north, midLng], [midLat, midLng, north, east]];
    quads.forEach((b, i) => split(list.filter(c => c.lat >= b[0] && (c.lat < b[2] || b[2] === 90) && c.lng >= b[1] && (c.lng < b[3] || b[3] === 180)), b, `${id}${i}`));
}
split(cities.filter(c => c.minZoom > BASE_MAX_ZOOM), [-90, -180, 90, 180], 't');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'countries.geojson'), JSON.stringify(countries));
const base = cities.filter(c => c.minZoom <= BASE_MAX_ZOOM);
fs.writeFileSync(path.join(outputDir, 'cities.json'), JSON.stringify(base));

// Tiles store compact rows [name, countryId, capital, population, minZoom, lat, lng].
const tileDir = path.join(outputDir, 'cities');
fs.rmSync(tileDir, { recursive: true, force: true });
fs.mkdirSync(tileDir);
for (const tile of tiles) {
    const rows = tile.list.sort((a, b) => a.minZoom - b.minZoom)
        .map(c => [c.name, c.countryId, c.capital, c.population, c.minZoom, c.lat, c.lng]);
    fs.writeFileSync(path.join(tileDir, `${tile.id}.json`), JSON.stringify(rows));
}
fs.writeFileSync(path.join(tileDir, 'index.json'), JSON.stringify(tiles.map(tile => ({
    id: tile.id, bounds: tile.bounds, minZoom: tile.list.reduce((min, c) => Math.min(min, c.minZoom), Infinity)
}))));

console.log(`Wrote ${countries.features.length} countries, ${base.length} base cities and `
    + `${cities.length - base.length} more in ${tiles.length} tiles to ${outputDir}`);
