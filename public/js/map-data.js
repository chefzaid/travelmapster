// The bundled map data: country borders as a searchable index, and the base list of towns, with
// countries named in the interface's language (ADR 0031).
import { createCountryIndex } from './geo.js';
import { locale } from './i18n.js';

export async function loadMapData() {
    const [countries, cities] = await Promise.all([
        // Relative to this module, so data comes from the same release as the code.
        fetch(new URL('../data/countries.geojson', import.meta.url)).then(res => res.json()),
        fetch(new URL('../data/cities.json', import.meta.url)).then(res => res.json())
    ]);
    const index = createCountryIndex(countries, { locale: locale() });
    for (const city of cities) city.country = index.byId.get(city.countryId)?.name || city.country;
    return { index, cities };
}
