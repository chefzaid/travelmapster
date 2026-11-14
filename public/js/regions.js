// Regions: the states, provinces and regions of the largest countries (Natural Earth admin-1,
// public domain, in public/data/regions.geojson). A region counts as visited once a town been
// to lies in it, as a country counts once a place in it is visited. Pure, unit tested in Node.
import { geometryContains } from './geo.js';
import { statusOf } from './status.js';

// The bounding box of a Polygon or MultiPolygon, to skip most regions quickly.
function bounds(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of polygons.flat()) {
        for (const [lng, lat] of ring) {
            box[0] = Math.min(box[0], lng);
            box[1] = Math.min(box[1], lat);
            box[2] = Math.max(box[2], lng);
            box[3] = Math.max(box[3], lat);
        }
    }
    return box;
}

/** The regions, named in `locale` where the data has a name for it, grouped by country. */
export function regionIndex(geojson, locale = 'en') {
    const regions = geojson.features.map(({ properties: p, geometry }) => ({
        id: p.id, name: p.names?.[locale] || p.name, countryId: p.countryId, geometry, box: bounds(geometry)
    }));
    const byCountry = new Map();
    for (const region of regions) byCountry.set(region.countryId, [...(byCountry.get(region.countryId) || []), region]);
    return { regions, byCountry };
}

// Outlines are simplified to about 2 km, so a town on the coast can fall just outside its
// region: within this many degrees (about 25 km), the nearest region counts.
const COAST_MARGIN = 0.25;

// The distance in degrees from a point to a polygon's outline, longitude scaled for latitude.
function distanceToOutline(geometry, lat, lng) {
    const scale = Math.cos((lat * Math.PI) / 180);
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let best = Infinity;
    for (const ring of polygons.flat()) {
        for (let i = 1; i < ring.length; i += 1) {
            const [ax, ay] = [ring[i - 1][0] * scale, ring[i - 1][1]];
            const [bx, by] = [ring[i][0] * scale, ring[i][1]];
            const [px, py] = [lng * scale, lat];
            const length = (bx - ax) ** 2 + (by - ay) ** 2;
            const step = length ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length)) : 0;
            best = Math.min(best, Math.hypot(px - (ax + step * (bx - ax)), py - (ay + step * (by - ay))));
        }
    }
    return best;
}

const near = ({ box }, lat, lng, margin) => lng >= box[0] - margin && lng <= box[2] + margin && lat >= box[1] - margin && lat <= box[3] + margin;

/**
 * The region of `countryId` a point lies in, or the nearest within about 25 km of it, or null;
 * so a town near a border never counts for the country next door.
 */
export function regionAt(index, countryId, lat, lng) {
    const candidates = index.byCountry.get(countryId) || [];
    const inside = candidates.find(region => near(region, lat, lng, 0) && geometryContains(region.geometry, lat, lng));
    if (inside) return inside;
    let best = null;
    let bestDistance = COAST_MARGIN;
    for (const region of candidates) {
        if (!near(region, lat, lng, COAST_MARGIN)) continue;
        const distance = distanceToOutline(region.geometry, lat, lng);
        if (distance < bestDistance) {
            best = region;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * The regions of each country covered with at least one town been to (visited, lived in or
 * passed through), as `{ countryId, total, visited: [{ region, towns }] }`, the most visited
 * share of a country first, and its regions by name. `countryOf(marker)` is the town's country.
 */
export function regionProgress(index, markers, countryOf) {
    const visited = new Map();
    for (const marker of markers) {
        if (marker.category !== 'City' || statusOf(marker) === 'wishlist') continue;
        const region = regionAt(index, countryOf(marker), Number(marker.lat), Number(marker.lng));
        if (!region) continue;
        const entry = visited.get(region.id) || { region, towns: [] };
        // "Austin, United States of America" is Austin within its country.
        entry.towns.push(String(marker.name).split(',')[0].trim());
        visited.set(region.id, entry);
    }
    const countries = new Map();
    for (const entry of visited.values()) {
        const { countryId } = entry.region;
        const country = countries.get(countryId) || { countryId, total: index.byCountry.get(countryId).length, visited: [] };
        country.visited.push(entry);
        countries.set(countryId, country);
    }
    return [...countries.values()]
        .map(country => ({ ...country, visited: country.visited.sort((a, b) => a.region.name.localeCompare(b.region.name)) }))
        .sort((a, b) => b.visited.length / b.total - a.visited.length / a.total || a.countryId.localeCompare(b.countryId));
}
