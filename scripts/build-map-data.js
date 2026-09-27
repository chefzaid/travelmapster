#!/usr/bin/env node
// Builds the compact map data served from public/data from Natural Earth sources.
//
// Usage:
//   node scripts/build-map-data.js <natural-earth-geojson-dir>
//
// The directory must contain ne_50m_admin_0_countries.geojson and
// ne_10m_populated_places_simple.geojson, downloaded from
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson (public domain).

const fs = require('node:fs');
const path = require('node:path');

const sourceDir = process.argv[2];
if (!sourceDir) {
    console.error('Usage: node scripts/build-map-data.js <natural-earth-geojson-dir>');
    process.exit(1);
}

const outputDir = path.join(__dirname, '..', 'public', 'data');
const PRECISION = 2; // ~1 km, plenty for a cartoon world map
const TOLERANCE = 0.04; // degrees; smooths coastlines into a friendlier, cartoon shape
// Keep every place Natural Earth labels by the map's deepest zoom; its min_zoom
// grades them so more cities appear at each zoom step.
const MAX_MAP_ZOOM = 8;
const EXCLUDED_PLACE_CLASSES = new Set(['Scientific station', 'Meteorological Station', 'Historic place']);

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

const placesSource = readGeoJson('ne_10m_populated_places_simple.geojson');
const cities = placesSource.features
    .map(feature => feature.properties)
    .filter(p => !EXCLUDED_PLACE_CLASSES.has(p.featurecla) && p.min_zoom <= MAX_MAP_ZOOM)
    .map(p => ({
        name: p.name,
        country: p.adm0name,
        countryId: p.adm0_a3,
        capital: p.featurecla.startsWith('Admin-0 capital') ? 1 : 0,
        population: p.pop_max,
        rank: p.scalerank,
        minZoom: p.min_zoom,
        lat: round(p.latitude),
        lng: round(p.longitude)
    }))
    .sort((first, second) => second.population - first.population);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'countries.geojson'), JSON.stringify(countries));
fs.writeFileSync(path.join(outputDir, 'cities.json'), JSON.stringify(cities));

console.log(`Wrote ${countries.features.length} countries and ${cities.length} cities to ${outputDir}`);
