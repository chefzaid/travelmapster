// Prototype: the TravelMapster map drawn with MapLibre GL (WebGL), to compare zooming
// with the Leaflet map. Same data and cartoon look; no accounts, pins or cards.
import { Map as MapLibreMap, NavigationControl, Popup } from '../vendor/maplibre/maplibre-gl.mjs';

const LAND = ['#ffe8a3', '#c7ecb5', '#ffd0c2', '#d8cff7', '#bfe6e0', '#ffd9ec', '#f5dfb9'];
const INK = '#1f3b57';
// MapLibre zooms are one lower than Leaflet's for the same scale (512 px tiles).
const ZOOM_OFFSET = 1;
const dataUrl = file => new URL(`../data/${file}`, import.meta.url);
const fontUrl = file => new URL(`../vendor/fonts/${file}`, import.meta.url).href;

// Round map markers drawn once and uploaded to the GPU as images.
function dotImage(capital) {
    const ratio = 2;
    const size = (capital ? 18 : 14) * ratio;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    const center = size / ratio / 2;
    context.beginPath();
    context.arc(center, center, center - 2, 0, Math.PI * 2);
    context.fillStyle = capital ? '#c93636' : '#fff';
    context.fill();
    context.lineWidth = 2.5;
    context.strokeStyle = INK;
    context.stroke();
    if (capital) {
        context.fillStyle = '#fff';
        context.font = '10px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('★', center, center + 0.5);
    }
    return { image: context.getImageData(0, 0, size, size), pixelRatio: ratio };
}

const toFeature = ({ name, country, capital, population, minZoom, lat, lng }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { name, country, capital, population, minZoom: minZoom - ZOOM_OFFSET }
});

async function start() {
    const [countries, baseCities, tileIndex] = await Promise.all([
        fetch(dataUrl('countries.geojson')).then(res => res.json()),
        fetch(dataUrl('cities.json')).then(res => res.json()),
        fetch(dataUrl('cities/index.json')).then(res => res.json())
    ]);
    const labels = {
        type: 'FeatureCollection',
        features: countries.features.map(({ properties }) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [properties.label[1], properties.label[0]] },
            properties: { name: properties.name, labelZoom: properties.labelZoom || 5 }
        }))
    };
    const countryNames = new Map(countries.features.map(({ properties }) => [properties.id, properties.name]));
    const cityFeatures = baseCities.map(toFeature);
    const atlasLines = {
        type: 'FeatureCollection',
        features: [0, 23.44, -23.44].map(lat => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] }, properties: {} }))
    };

    const map = new MapLibreMap({
        container: 'map',
        center: [10, 25],
        zoom: 1.5,
        minZoom: 1,
        maxZoom: 11 - ZOOM_OFFSET,
        renderWorldCopies: false,
        attributionControl: { customAttribution: 'Borders: Natural Earth · Places: GeoNames (CC BY 4.0) · MapLibre' },
        style: {
            version: 8,
            // Text is drawn in the browser from the app's own fonts; no glyph server needed.
            'font-faces': {
                Nunito: fontUrl('nunito-latin-wght-normal.woff2'),
                Fredoka: fontUrl('fredoka-latin-wght-normal.woff2')
            },
            sources: {
                countries: { type: 'geojson', data: countries },
                labels: { type: 'geojson', data: labels },
                atlas: { type: 'geojson', data: atlasLines },
                cities: { type: 'geojson', data: { type: 'FeatureCollection', features: cityFeatures.filter(f => f.properties.minZoom <= 3) } }
            },
            layers: [
                { id: 'ocean', type: 'background', paint: { 'background-color': '#8fd3f4' } },
                { id: 'atlas', type: 'line', source: 'atlas', paint: { 'line-color': 'rgba(255,255,255,0.7)', 'line-width': 1.5, 'line-dasharray': [4, 4] } },
                {
                    id: 'land', type: 'fill', source: 'countries',
                    paint: { 'fill-color': ['match', ['get', 'color'], ...LAND.flatMap((colour, i) => [i + 1, colour]), LAND[0]] }
                },
                {
                    id: 'borders', type: 'line', source: 'countries',
                    layout: { 'line-join': 'round' },
                    paint: { 'line-color': 'rgba(31,59,87,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1, 6, 1.6, 10, 2.2] }
                },
                {
                    id: 'cities', type: 'symbol', source: 'cities',
                    filter: ['>=', ['zoom'], ['get', 'minZoom']],
                    layout: {
                        'icon-image': ['case', ['==', ['get', 'capital'], 1], 'dot-capital', 'dot'],
                        'text-field': ['get', 'name'],
                        'text-font': ['Nunito'],
                        'text-size': ['case', ['==', ['get', 'capital'], 1], 12.5, 11.5],
                        // Name on the right, or on the left when the right side is taken.
                        'text-variable-anchor': ['left', 'right'],
                        'text-radial-offset': 0.8,
                        'text-justify': 'auto',
                        // Capitals first, then places in the order they appear.
                        'symbol-sort-key': ['-', ['get', 'minZoom'], ['*', 100, ['get', 'capital']]],
                        'text-padding': 2
                    },
                    paint: { 'text-color': INK, 'text-halo-color': '#fff', 'text-halo-width': 1.6 }
                },
                // Last in the stack, so country names win label collisions against towns.
                {
                    id: 'country-labels', type: 'symbol', source: 'labels', maxzoom: 7 - ZOOM_OFFSET,
                    layout: {
                        'text-field': ['get', 'name'],
                        'text-font': ['Fredoka'],
                        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 3, 14, 5, 17],
                        'text-max-width': 8,
                        'text-padding': 4,
                        'symbol-sort-key': ['get', 'labelZoom']
                    },
                    paint: { 'text-color': INK, 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 2 }
                }
            ]
        }
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
        map.addImage('dot', dotImage(false).image, { pixelRatio: 2 });
        map.addImage('dot-capital', dotImage(true).image, { pixelRatio: 2 });
    });

    // Smaller towns arrive in region tiles as you approach their zoom.
    const loaded = new Set();
    function loadTiles() {
        const bounds = map.getBounds();
        const zoom = map.getZoom() + ZOOM_OFFSET;
        const wanted = tileIndex.filter(({ id, bounds: [south, west, north, east], minZoom }) => !loaded.has(id)
            && zoom >= minZoom - 1 && south < bounds.getNorth() && north > bounds.getSouth() && west < bounds.getEast() && east > bounds.getWest());
        for (const { id } of wanted) {
            loaded.add(id);
            fetch(dataUrl(`cities/${id}.json`))
                .then(res => res.json())
                .then(rows => {
                    for (const [name, countryId, capital, population, minZoom, lat, lng] of rows) {
                        cityFeatures.push(toFeature({ name, country: countryNames.get(countryId) || '', capital, population, minZoom, lat, lng }));
                    }
                    scheduleUpdate();
                })
                .catch(() => loaded.delete(id));
        }
    }

    // Hand MapLibre only the towns that can appear near the current zoom, and batch
    // tile arrivals, so it never re-indexes every loaded town on each change.
    let shownLimit = null;
    let updateTimer = 0;
    function updateSource() {
        shownLimit = Math.floor(map.getZoom()) + 2;
        map.getSource('cities').setData({ type: 'FeatureCollection', features: cityFeatures.filter(f => f.properties.minZoom <= shownLimit) });
    }
    function scheduleUpdate() {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(updateSource, 150);
    }
    map.on('moveend', () => {
        loadTiles();
        if (Math.floor(map.getZoom()) + 2 !== shownLimit) scheduleUpdate();
    });

    for (const layer of ['cities', 'land']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
    map.on('click', event => {
        const [feature] = map.queryRenderedFeatures(event.point, { layers: ['cities', 'land'] });
        if (!feature) return;
        const { name, country } = feature.properties;
        new Popup({ closeButton: false }).setLngLat(event.lngLat)
            .setText(feature.layer.id === 'cities' ? `${name}, ${country}` : name)
            .addTo(map);
    });
    globalThis.__prototypeMap = map;
}

start();
