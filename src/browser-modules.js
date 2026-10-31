'use strict';

// The browser's own modules, loaded by the server where both must count alike (ADR 0022,
// ADR 0023): geo.js finds a place's country over the bundled borders, days.js counts days, and
// itinerary.js turns a trip into planned stays.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const modules = new Map();
/** A module of public/js, imported once. */
function browserModule(file, publicDir = PUBLIC_DIR) {
    const url = pathToFileURL(path.join(publicDir, 'js', file)).href;
    if (!modules.has(url)) {
        modules.set(url, import(url));
        modules.get(url).catch(() => modules.delete(url));
    }
    return modules.get(url);
}

const geographies = new Map();
/** The bundled country borders, their GeoJSON and the index geo.js builds from them, loaded once. */
function countryData(publicDir = PUBLIC_DIR) {
    if (!geographies.has(publicDir)) {
        const loading = (async () => {
            const [{ createCountryIndex }, text] = await Promise.all([
                browserModule('geo.js', publicDir),
                fs.readFile(path.join(publicDir, 'data', 'countries.geojson'), 'utf8')
            ]);
            const geojson = JSON.parse(text);
            return { geojson, index: createCountryIndex(geojson) };
        })();
        geographies.set(publicDir, loading);
        loading.catch(() => geographies.delete(publicDir));
    }
    return geographies.get(publicDir);
}

const towns = new Map();
/** The bundled base list of towns (name, country, position), loaded once. */
function townData(publicDir = PUBLIC_DIR) {
    if (!towns.has(publicDir)) {
        const loading = fs.readFile(path.join(publicDir, 'data', 'cities.json'), 'utf8').then(JSON.parse);
        towns.set(publicDir, loading);
        loading.catch(() => towns.delete(publicDir));
    }
    return towns.get(publicDir);
}

module.exports = { browserModule, countryData, townData };
