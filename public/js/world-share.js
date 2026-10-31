// How much of the world the countries been to cover: their share of the land, from the map's
// shapes, and of the people, from the bundled populations. Pure, unit tested in Node.

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

// The area a ring encloses on the sphere, signed by its direction (as d3 and turf do).
function ringArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
        const [lng1, lat1] = ring[i];
        const [lng2, lat2] = ring[i + 1];
        sum += (lng2 - lng1) * RAD * (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD));
    }
    return (sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2;
}

const polygonArea = ([outer, ...holes]) => Math.abs(ringArea(outer)) - holes.reduce((total, hole) => total + Math.abs(ringArea(hole)), 0);

/** A Polygon or MultiPolygon's area in square kilometers. */
export function areaKm2(geometry) {
    if (geometry?.type === 'Polygon') return polygonArea(geometry.coordinates);
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates.reduce((total, polygon) => total + polygonArea(polygon), 0);
    return 0;
}

// Areas are worked out once per country.
const areas = new Map();
const areaOf = country => {
    if (!areas.has(country.id)) areas.set(country.id, areaKm2(country.feature?.geometry));
    return areas.get(country.id);
};

/**
 * The share (0 to 1) of the world's land and people in the countries been to, over every
 * country and territory on the map: `{ land, people }`.
 */
export function worldShare(countries, visitedIds) {
    let land = 0;
    let people = 0;
    let landBeen = 0;
    let peopleBeen = 0;
    for (const country of countries) {
        const area = areaOf(country);
        const population = Number(country.population) || 0;
        land += area;
        people += population;
        if (visitedIds.has(country.id)) {
            landBeen += area;
            peopleBeen += population;
        }
    }
    return { land: land ? landBeen / land : 0, people: people ? peopleBeen / people : 0 };
}
