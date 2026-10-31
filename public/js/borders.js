// Land borders from the map's own shapes: neighboring countries share the vertices of their
// border. "One border away" suggests the countries next to those been to. Pure, unit tested in
// Node.

// A vertex as one number: longitude and latitude to 1e-4 degrees, as the shapes are stored.
const vertexKey = ([lng, lat]) => (Math.round(lng * 1e4) + 1_800_000) * 2_000_000 + Math.round(lat * 1e4) + 900_000;

const polygonsOf = geometry => (geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);

// Worked out once for a list of countries.
const cache = new WeakMap();

/** Each country's land neighbors: a Map of country id → Set of ids. */
export function landNeighbors(countries) {
    if (cache.has(countries)) return cache.get(countries);
    const owners = new Map();
    for (const country of countries) {
        for (const polygon of polygonsOf(country.feature?.geometry)) {
            for (const ring of polygon) {
                for (const point of ring) {
                    const key = vertexKey(point);
                    const first = owners.get(key);
                    if (first === undefined) owners.set(key, country.id);
                    else if (first !== country.id) owners.set(key, first instanceof Set ? first.add(country.id) : new Set([first, country.id]));
                }
            }
        }
    }
    const neighbors = new Map(countries.map(country => [country.id, new Set()]));
    for (const owner of owners.values()) {
        if (!(owner instanceof Set)) continue;
        for (const a of owner) for (const b of owner) if (a !== b) neighbors.get(a).add(b);
    }
    cache.set(countries, neighbors);
    return neighbors;
}

/**
 * Countries not been to that border one been to, those next to the most first: `{ country,
 * via }` with the bordering countries been to, by name.
 */
export function oneBorderAway(countries, visitedIds) {
    const neighbors = landNeighbors(countries);
    const byId = new Map(countries.map(country => [country.id, country]));
    const found = new Map();
    for (const id of visitedIds) {
        for (const next of neighbors.get(id) || []) {
            if (visitedIds.has(next)) continue;
            if (!found.has(next)) found.set(next, []);
            found.get(next).push(byId.get(id));
        }
    }
    return [...found.entries()]
        .map(([id, via]) => ({ country: byId.get(id), via: via.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)) }))
        .filter(item => item.country)
        .sort((a, b) => b.via.length - a.via.length || a.country.name.localeCompare(b.country.name));
}
