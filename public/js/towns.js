// The town a point is in or near, from the bundled towns (the base list and the region tiles
// around the point), so an import keeps a town and never the exact position. Pure, unit tested
// in Node: the tiles are loaded through `loadTile`.
import { distanceKm } from './travel-stats.js';

// Within this distance the largest town wins (a district of Paris is Paris); beyond it, up to
// the second distance, the nearest town.
const LARGEST_WITHIN_KM = 10;
const NEAREST_WITHIN_KM = 30;
// Closer than this, two towns are one (as duplicates.js counts them).
const SAME_TOWN_KM = 2;
const CELL = 1;

const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}|${Math.floor(lng / CELL)}`;

/**
 * A finder of towns: `cities` are the base list ({ name, countryId, population, lat, lng }),
 * `tiles` the region tiles' index ({ id, bounds: [south, west, north, east] }) and `loadTile(id)`
 * resolves to a tile's rows `[name, countryId, capital, population, minZoom, lat, lng]`.
 */
export function createTownFinder({ cities, tiles = [], loadTile }) {
    const grid = new Map();
    const seen = new Set();
    const add = town => {
        const key = `${town.countryId}|${town.name}|${town.lat}|${town.lng}`;
        if (seen.has(key)) return;
        seen.add(key);
        const cell = cellKey(town.lat, town.lng);
        if (grid.has(cell)) grid.get(cell).push(town);
        else grid.set(cell, [town]);
    };
    cities.forEach(add);
    const loading = new Map();

    function loadAround(lat, lng) {
        const margin = 0.5;
        const due = tiles.filter(({ bounds: [south, west, north, east] }) =>
            south <= lat + margin && north >= lat - margin && west <= lng + margin && east >= lng - margin);
        return Promise.all(due.map(({ id }) => {
            if (!loading.has(id)) {
                loading.set(id, loadTile(id).then(rows => {
                    for (const [name, countryId, , population, , townLat, townLng] of rows) {
                        add({ name, countryId, population, lat: townLat, lng: townLng });
                    }
                }).catch(() => loading.delete(id)));
            }
            return loading.get(id);
        }));
    }

    // The towns of the cells around a point, with their distance, within `km` of it.
    function townsWithin(lat, lng, km) {
        const point = { lat, lng };
        const found = [];
        const [row, column] = [Math.floor(lat / CELL), Math.floor(lng / CELL)];
        for (let dRow = -1; dRow <= 1; dRow++) {
            for (let dColumn = -1; dColumn <= 1; dColumn++) {
                for (const town of grid.get(`${row + dRow}|${column + dColumn}`) || []) {
                    const distance = distanceKm(point, town);
                    if (distance <= km) found.push({ town, distance });
                }
            }
        }
        return found;
    }

    /**
     * The largest towns within `km` (up to 50) of a point, the point's own town left out, and
     * those `skip(town)` turns down: `{ name, countryId, population, lat, lng, distance }`.
     * @param {number} lat
     * @param {number} lng
     * @param {{ km?: number, limit?: number, skip?: (town: { name: string, countryId: string, population: number, lat: number, lng: number }) => boolean }} [options]
     */
    async function townsAround(lat, lng, { km = 50, limit = 5, skip = () => false } = {}) {
        await loadAround(lat, lng);
        return townsWithin(lat, lng, Math.min(km, 50))
            .filter(({ town, distance }) => distance >= SAME_TOWN_KM && !skip(town))
            .sort((a, b) => b.town.population - a.town.population || a.distance - b.distance)
            .slice(0, limit)
            .map(({ town, distance }) => ({ ...town, distance }));
    }

    /** The town for a point: `{ name, countryId, lat, lng }`, or null far from any town. */
    async function townNear(lat, lng) {
        await loadAround(lat, lng);
        const candidates = townsWithin(lat, lng, NEAREST_WITHIN_KM);
        const near = candidates.filter(candidate => candidate.distance <= LARGEST_WITHIN_KM);
        const best = near.length
            ? near.reduce((a, b) => (b.town.population > a.town.population ? b : a))
            : candidates.reduce((a, b) => (b.distance < a.distance ? b : a), candidates[0]);
        if (!best) return null;
        const { name, countryId, lat: townLat, lng: townLng } = best.town;
        return { name, countryId, lat: townLat, lng: townLng };
    }

    return Object.assign(townNear, { townsAround });
}
