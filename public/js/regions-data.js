// The outlines of the largest countries' states and provinces (public/data/regions.geojson),
// fetched once and shared by the passport and the map, named in the interface's language.
import { regionIndex } from './regions.js';
import { locale } from './i18n.js';

let loading = null;

/** The regions' GeoJSON and their index (regions.js), loaded the first time they are needed. */
export function loadRegions() {
    loading ||= fetch(new URL('../data/regions.geojson', import.meta.url))
        .then(response => response.json())
        .then(geojson => ({ geojson, index: regionIndex(geojson, locale()) }));
    return loading;
}
