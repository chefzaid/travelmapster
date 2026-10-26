// The embeddable map (/embed/<username>): a public travel map for other websites to frame,
// read-only and with only what the public map shares (ADR 0020).
import { api } from './api.js';
import { $ } from './ui.js';
import { computeStats } from './geo.js';
import { createTravelMap } from './map.js';
import { loadMapData } from './map-data.js';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const ignore = () => {};

async function init() {
    const username = decodeURIComponent(location.pathname.split('/')[2] || '');
    const { index, cities } = await loadMapData();
    const travelMap = createTravelMap($('#map'), { index, cities, onCountryClick: ignore, onCityClick: ignore, onPinClick: ignore });
    let data;
    try {
        data = await api.getPublicMap(username);
    } catch {
        $('#embed-title').textContent = 'Travel map';
        $('#embed-stats').textContent = 'This map is private, or does not exist.';
        return;
    }
    const stats = computeStats(data.markers, index, { countryList: data.countryList, capitals: cities.filter(city => city.capital) });
    travelMap.setCountryStatus(stats);
    travelMap.setPins(data.markers);
    const title = `${data.username}'s travel map`;
    $('#embed-title').textContent = title;
    document.title = `${title} · TravelMapster`;
    $('#embed-stats').textContent = `${plural(stats.visitedCountries, 'country', 'countries')}, ${plural(stats.visitedCities, 'city', 'cities')}`;
    $('#embed-link').href = `/?u=${encodeURIComponent(data.username)}`;
}

init().catch(error => {
    console.error(error);
    $('#embed-stats').textContent = 'The map could not load.';
});
