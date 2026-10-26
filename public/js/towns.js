// The town a point is in or near, from the bundled towns (the base list and the region tiles
// around the point), so an import keeps a town and never the exact position. Pure, unit tested
// in Node: the tiles are loaded through `loadTile`.
import { distanceKm } from './travel-stats.js';

// Within this distance the largest town wins (a district of Paris is Paris); beyond it, up to
// the second distance, the nearest town.
const LARGEST_WITHIN_KM = 10;
const NEAREST_WITHIN_KM = 30;
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

    /** The town for a point: `{ name, countryId, lat, lng }`, or null far from any town. */
    return async function townNear(lat, lng) {
        await loadAround(lat, lng);
        const point = { lat, lng };
        const candidates = [];
        const [row, column] = [Math.floor(lat / CELL), Math.floor(lng / CELL)];
        for (let dRow = -1; dRow <= 1; dRow++) {
            for (let dColumn = -1; dColumn <= 1; dColumn++) {
                for (const town of grid.get(`${row + dRow}|${column + dColumn}`) || []) {
                    const distance = distanceKm(point, town);
                    if (distance <= NEAREST_WITHIN_KM) candidates.push({ town, distance });
                }
            }
        }
        const near = candidates.filter(candidate => candidate.distance <= LARGEST_WITHIN_KM);
        const best = near.length
            ? near.reduce((a, b) => (b.town.population > a.town.population ? b : a))
            : candidates.reduce((a, b) => (b.distance < a.distance ? b : a), candidates[0]);
        if (!best) return null;
        const { name, countryId, lat: townLat, lng: townLng } = best.town;
        return { name, countryId, lat: townLat, lng: townLng };
    };
}
