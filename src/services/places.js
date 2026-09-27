'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DATA_DIR = path.join(__dirname, '..', '..', 'public', 'data');

/**
 * Search over every town in the bundled map data (about 225,000 places): the browser
 * only holds the big cities, so smaller places are found here instead of hitting
 * Nominatim. Names are normalized once at load time, the same way the browser does.
 */
function createPlaceIndex(dataDir = DATA_DIR) {
    let loading = null;

    async function load() {
        const { normalizeName, splitPlaceQuery } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'geo.js')).href);
        const read = async file => JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));
        const countries = new Map((await read('countries.geojson')).features.map(f => [f.properties.id, f.properties.name]));
        const places = (await read('cities.json')).map(city => ({ ...city }));
        for (const { id } of await read('cities/index.json')) {
            for (const [name, countryId, capital, population, minZoom, lat, lng] of await read(`cities/${id}.json`)) {
                places.push({ name, country: countries.get(countryId) || '', countryId, capital, population, minZoom, lat, lng });
            }
        }
        const entries = places.map(city => ({ city, key: normalizeName(city.name), countryKey: normalizeName(city.country) }));
        return { entries, splitPlaceQuery };
    }

    /** Best matches first: exact name, then prefix, then substring; bigger places break ties. */
    async function search(query, limit = 8) {
        loading ??= load();
        const { entries, splitPlaceQuery } = await loading;
        const [cityPart, countryPart] = splitPlaceQuery(query);
        if (!cityPart) return [];
        const matches = [];
        for (const entry of entries) {
            let score = -1;
            if (entry.key === cityPart) score = 0;
            else if (entry.key.startsWith(cityPart)) score = 1;
            else if (entry.key.includes(cityPart)) score = 3;
            if (score < 0 || (countryPart && !entry.countryKey.startsWith(countryPart))) continue;
            matches.push({ city: entry.city, score });
        }
        return matches
            .sort((a, b) => a.score - b.score || b.city.population - a.city.population)
            .slice(0, limit)
            .map(({ city }) => city);
    }

    return { search, warm: () => { loading ??= load(); return loading.then(() => undefined); } };
}

module.exports = { createPlaceIndex };
