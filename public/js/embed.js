// The embeddable map (/embed/<username>): a public travel map for other websites to frame,
// read-only and with only what the public map shares (ADR 0020).
import { api } from './api.js';
import { $ } from './ui.js';
import { computeStats } from './geo.js';
import { createTravelMap } from './map.js';
import { loadMapData } from './map-data.js';
import { loadLocale, preferredLocale, translateDom, t, tn } from './i18n.js';

const ignore = () => {};

async function init() {
    await loadLocale(preferredLocale()).catch(() => {});
    translateDom();
    const username = decodeURIComponent(location.pathname.split('/')[2] || '');
    const { index, cities } = await loadMapData();
    const travelMap = createTravelMap($('#map'), { index, cities, onCountryClick: ignore, onCityClick: ignore, onPinClick: ignore });
    let data;
    try {
        data = await api.getPublicMap(username);
    } catch {
        $('#embed-title').textContent = t('Travel map');
        $('#embed-stats').textContent = t('This map is private, or does not exist.');
        return;
    }
    const stats = computeStats(data.markers, index, { countryList: data.countryList, capitals: cities.filter(city => city.capital) });
    travelMap.setCountryStatus(stats);
    travelMap.setPins(data.markers);
    const title = t('{username}\'s travel map', { username: data.username });
    $('#embed-title').textContent = title;
    document.title = t('{title} · TravelMapster', { title });
    $('#embed-stats').textContent = `${tn(stats.visitedCountries, '{count} country', '{count} countries')}, ${tn(stats.visitedCities, '{count} city', '{count} cities')}`;
    $('#embed-link').href = `/?u=${encodeURIComponent(data.username)}`;
}

init().catch(error => {
    console.error(error);
    $('#embed-stats').textContent = t('The map could not load.');
});
