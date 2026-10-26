// The bundled map data: country borders as a searchable index, and the base list of towns.
import { createCountryIndex } from './geo.js';

export async function loadMapData() {
    const [countries, cities] = await Promise.all([
        // Relative to this module, so data comes from the same release as the code.
        fetch(new URL('../data/countries.geojson', import.meta.url)).then(res => res.json()),
        fetch(new URL('../data/cities.json', import.meta.url)).then(res => res.json())
    ]);
    return { index: createCountryIndex(countries), cities };
}
