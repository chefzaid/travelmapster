// Cartoon world map drawn on the GPU with MapLibre GL: country shapes and every town,
// with smooth, continuous zooming. See docs/adr/0008-maplibre-gl.md.
import { Map as MapLibreMap, Marker, Popup } from '../vendor/maplibre/maplibre-gl.mjs';

// The app and its data use Leaflet-scale zooms; MapLibre's are one lower for the same scale.
const ZOOM_OFFSET = 1;
const MAX_ZOOM = 11;
const COUNTRY_LABELS_MAX_ZOOM = 7;
// Whole countries light up on hover only at world scale; up close they fill the screen.
const HOVER_FILL_MAX_ZOOM = 7;
const DEFAULT_VIEW = { center: [10, 25], zoom: 2.5 };

const toMapZoom = zoom => zoom - ZOOM_OFFSET;
const lngLat = point => (Array.isArray(point) ? [point[1], point[0]] : [point.lng, point.lat]);
const dataUrl = file => new URL(`../data/${file}`, import.meta.url);
const fontUrl = file => new URL(`../vendor/fonts/${file}`, import.meta.url).href;

// Colours come from the CSS design tokens, so the map follows the light and dark themes.
function readTheme() {
    const style = getComputedStyle(document.documentElement);
    const token = name => style.getPropertyValue(name).trim();
    return {
        land: [1, 2, 3, 4, 5, 6, 7].map(n => token(`--land-${n}`)),
        border: token('--border-ink'),
        ink: token('--ink'),
        inkDark: token('--ink-dark'),
        visited: token('--visited'),
        visitedInk: token('--visited-ink'),
        visitedSoft: token('--visited-soft'),
        wishlist: token('--wishlist'),
        wishlistInk: token('--wishlist-ink'),
        capital: token('--primary-strong'),
        graticule: token('--graticule'),
        shadow: token('--shadow-color')
    };
}

// Round town markers, drawn once and uploaded to the GPU as images.
function dotImage(theme, capital) {
    const ratio = 2;
    const css = capital ? 18 : 14;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = css * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    const center = css / 2;
    context.beginPath();
    context.arc(center, center, center - 2, 0, Math.PI * 2);
    context.fillStyle = capital ? theme.capital : '#fff';
    context.fill();
    context.lineWidth = 2.5;
    context.strokeStyle = theme.ink;
    context.stroke();
    if (capital) {
        context.fillStyle = '#fff';
        context.font = '10px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('★', center, center + 0.5);
    }
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

const state = name => ['boolean', ['feature-state', name], false];

function countryFill(theme) {
    const land = ['match', ['get', 'color'], ...theme.land.flatMap((colour, i) => [i + 1, colour]), theme.land[0]];
    const status = ['case',
        ['all', state('visited'), state('cityOnly'), ['!', state('wishlist')]], theme.visitedSoft,
        state('visited'), theme.visited,
        state('wishlist'), theme.wishlist,
        land];
    const hovered = ['case',
        ['!', state('hover')], status,
        state('visited'), '#5ad8cc',
        state('wishlist'), '#ffd452',
        '#fff'];
    return ['step', ['zoom'], hovered, toMapZoom(HOVER_FILL_MAX_ZOOM), status];
}

function buildStyle(theme, countries, labels) {
    const atlasLines = [
        { lat: 0, name: 'Equator' },
        { lat: 23.44, name: 'Tropic of Cancer' },
        { lat: -23.44, name: 'Tropic of Capricorn' }
    ];
    return {
        version: 8,
        // Text is drawn in the browser from the app's own fonts; no glyph server is needed.
        // The weight comes from the name ("Extra Bold" is 800).
        'font-faces': {
            'Fredoka SemiBold': fontUrl('fredoka-latin-wght-normal.woff2'),
            'Nunito Extra Bold': fontUrl('nunito-latin-wght-normal.woff2')
        },
        sources: {
            countries: { type: 'geojson', data: countries, promoteId: 'id' },
            labels: { type: 'geojson', data: labels },
            atlas: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: atlasLines.flatMap(({ lat, name }) => [
                        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] }, properties: {} },
                        { type: 'Feature', geometry: { type: 'Point', coordinates: [-168, lat] }, properties: { name } }
                    ])
                }
            },
            cities: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
        },
        layers: [
            // No background layer: the dotted ocean is the container's CSS background.
            {
                id: 'atlas-lines', type: 'line', source: 'atlas', filter: ['==', ['geometry-type'], 'LineString'],
                layout: { 'line-cap': 'round' },
                paint: { 'line-color': 'rgba(255,255,255,0.6)', 'line-width': 1.5, 'line-dasharray': [0.5, 5] }
            },
            {
                id: 'land-shadow', type: 'fill', source: 'countries',
                paint: { 'fill-color': theme.shadow, 'fill-opacity': 0.28, 'fill-translate': [3, 4] }
            },
            { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': countryFill(theme) } },
            {
                id: 'borders', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: { 'line-color': theme.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 1.8, 10, 2.4] }
            },
            {
                id: 'borders-visited', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: { 'line-color': theme.visitedInk, 'line-width': 2, 'line-opacity': ['case', ['all', state('visited'), ['!', state('wishlist')]], 1, 0] }
            },
            {
                id: 'borders-wishlist', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: { 'line-color': theme.wishlistInk, 'line-width': 2, 'line-dasharray': [2.5, 2], 'line-opacity': ['case', state('wishlist'), 1, 0] }
            },
            {
                id: 'borders-hover', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: { 'line-color': theme.ink, 'line-width': 2.5, 'line-opacity': ['case', state('hover'), 1, 0] }
            },
            {
                id: 'borders-pulse', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: {
                    'line-color': theme.capital,
                    'line-width': ['*', 7, ['number', ['feature-state', 'pulse'], 0]],
                    'line-opacity': ['number', ['feature-state', 'pulse'], 0]
                }
            },
            {
                id: 'atlas-labels', type: 'symbol', source: 'atlas', filter: ['==', ['geometry-type'], 'Point'],
                layout: {
                    'text-field': ['get', 'name'], 'text-font': ['Fredoka SemiBold'], 'text-size': 11,
                    'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-anchor': 'bottom-left', 'text-offset': [0, -0.4]
                },
                paint: { 'text-color': theme.graticule }
            },
            {
                // Every town, revealed at the zoom where its name fits (see data-model.md).
                id: 'cities', type: 'symbol', source: 'cities',
                filter: ['>=', ['zoom'], ['get', 'minZoom']],
                layout: {
                    'icon-image': ['case', ['==', ['get', 'capital'], 1], 'dot-capital', 'dot'],
                    'text-field': ['get', 'name'],
                    'text-font': ['Nunito Extra Bold'],
                    'text-size': ['case', ['==', ['get', 'capital'], 1], 12.5, 11.5],
                    // Name on the right, or on the left when the right side is taken.
                    'text-variable-anchor': ['left', 'right'],
                    'text-radial-offset': 0.8,
                    'text-justify': 'auto',
                    // Capitals first, then places in the order they appear.
                    'symbol-sort-key': ['-', ['get', 'minZoom'], ['*', 100, ['get', 'capital']]],
                    'text-padding': 2
                },
                paint: { 'text-color': theme.inkDark, 'text-halo-color': '#fff', 'text-halo-width': 1.6 }
            },
            {
                // At the deepest zoom, places whose name never finds room still show as a dot.
                id: 'city-dots', type: 'symbol', source: 'cities', minzoom: toMapZoom(MAX_ZOOM) - 0.01,
                filter: ['>', ['get', 'minZoom'], toMapZoom(MAX_ZOOM)],
                layout: { 'icon-image': 'dot', 'icon-allow-overlap': true }
            },
            {
                // Last in the stack, so country names win label collisions against towns.
                id: 'country-labels', type: 'symbol', source: 'labels', maxzoom: toMapZoom(COUNTRY_LABELS_MAX_ZOOM),
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Fredoka SemiBold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 2, 12, 3, 14, 5, 16],
                    'text-max-width': 8,
                    'text-padding': 4,
                    'text-letter-spacing': 0.02,
                    'symbol-sort-key': ['get', 'labelZoom']
                },
                paint: { 'text-color': theme.inkDark, 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 2 }
            }
        ]
    };
}

export function createTravelMap(element, { index, cities, onCountryClick, onCityClick, onPinClick, onPopupOpen }) {
    const countries = {
        type: 'FeatureCollection',
        features: index.countries.map(country => country.feature)
    };
    const labels = {
        type: 'FeatureCollection',
        features: index.countries.map(country => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: lngLat(country.label) },
            properties: { name: country.name, labelZoom: country.labelZoom || 5 }
        }))
    };
    let theme = readTheme();

    const map = new MapLibreMap({
        container: element,
        style: buildStyle(theme, countries, labels),
        center: DEFAULT_VIEW.center,
        zoom: toMapZoom(DEFAULT_VIEW.zoom),
        minZoom: toMapZoom(2),
        maxZoom: toMapZoom(MAX_ZOOM),
        renderWorldCopies: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: {
            compact: false,
            customAttribution: '<a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>'
                + ' · Borders: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a>'
                + ' · Places: <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)'
        }
    });
    map.touchZoomRotate.disableRotation();
    // Browser tests reach the map through its container.
    element.travelMap = map;

    const ready = new Promise(resolve => map.once('load', resolve));
    ready.then(() => {
        map.addImage('dot', dotImage(theme, false), { pixelRatio: 2 });
        map.addImage('dot-capital', dotImage(theme, true), { pixelRatio: 2 });
    });

    // Zoom buttons styled like the rest of the app.
    map.addControl({
        onAdd() {
            const group = document.createElement('div');
            group.className = 'maplibregl-ctrl zoom-control';
            for (const [label, text, action] of [['Zoom in', '+', () => map.zoomIn()], ['Zoom out', '−', () => map.zoomOut()]]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('aria-label', label);
                button.textContent = text;
                button.addEventListener('click', action);
                group.append(button);
            }
            return group;
        },
        onRemove() {}
    }, 'bottom-right');

    // ---- towns: the base list now, region tiles as you approach their zoom

    const countryNames = new Map(index.countries.map(country => [country.id, country.name]));
    const toFeature = ({ name, country, countryId, capital, population, minZoom, lat, lng }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { name, country, countryId, capital, population, minZoom: toMapZoom(minZoom), lat, lng }
    });
    const cityFeatures = cities.map(toFeature);
    const tiles = [];
    const loadedTiles = new Set();
    fetch(dataUrl('cities/index.json'))
        .then(response => (response.ok ? response.json() : []))
        .then(list => { tiles.push(...list); loadTiles(); })
        .catch(() => {});

    function loadTiles() {
        const bounds = map.getBounds();
        const zoom = map.getZoom() + ZOOM_OFFSET;
        for (const { id, bounds: [south, west, north, east], minZoom } of tiles) {
            // Fetch a zoom early so places are ready when they are due.
            if (loadedTiles.has(id) || zoom < minZoom - 1 || south > bounds.getNorth() || north < bounds.getSouth()
                || west > bounds.getEast() || east < bounds.getWest()) continue;
            loadedTiles.add(id);
            fetch(dataUrl(`cities/${id}.json`))
                .then(response => {
                    if (!response.ok) throw new Error(`City tile ${id}: HTTP ${response.status}`);
                    return response.json();
                })
                .then(rows => {
                    for (const [name, countryId, capital, population, minZoom, lat, lng] of rows) {
                        cityFeatures.push(toFeature({ name, country: countryNames.get(countryId) || '', countryId, capital, population, minZoom, lat, lng }));
                    }
                    scheduleCityUpdate();
                })
                .catch(() => loadedTiles.delete(id));
        }
    }

    // Hand MapLibre only the towns that can appear near the current zoom, in batches, so it
    // never re-indexes every loaded town on each change.
    let shownLimit = null;
    let cityTimer = 0;
    function updateCities() {
        shownLimit = Math.floor(map.getZoom()) + 2;
        map.getSource('cities')?.setData({ type: 'FeatureCollection', features: cityFeatures.filter(f => f.properties.minZoom <= shownLimit) });
    }
    function scheduleCityUpdate() {
        clearTimeout(cityTimer);
        cityTimer = setTimeout(() => ready.then(updateCities), 120);
    }
    map.on('moveend', () => {
        loadTiles();
        if (Math.floor(map.getZoom()) + 2 !== shownLimit) scheduleCityUpdate();
    });
    ready.then(updateCities);

    // ---- country status, hover and pulse

    let status = { visitedIds: new Set(), wishlistIds: new Set(), cityOnlyIds: new Set(), filter: 'all' };
    function applyStatus() {
        const { visitedIds, wishlistIds, cityOnlyIds, filter } = status;
        for (const country of index.countries) {
            const visited = visitedIds.has(country.id) && filter !== 'wishlist' && filter !== 'none';
            map.setFeatureState({ source: 'countries', id: country.id }, {
                visited,
                wishlist: wishlistIds.has(country.id) && filter !== 'visited' && filter !== 'none',
                cityOnly: visited && cityOnlyIds.has(country.id)
            });
        }
    }
    function setCountryStatus({ visitedIds, wishlistIds, cityOnlyIds }, filter = 'all') {
        status = { visitedIds, wishlistIds, cityOnlyIds, filter };
        ready.then(applyStatus);
    }

    function pulseCountry(countryId) {
        ready.then(() => {
            const started = performance.now();
            const frame = now => {
                const t = Math.min((now - started) / 1100, 1);
                // Swell quickly, then settle, like the old CSS pulse.
                const value = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
                map.setFeatureState({ source: 'countries', id: countryId }, { pulse: Math.max(value, 0) });
                if (t < 1) requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        });
    }

    const hoverTip = new Popup({ closeButton: false, closeOnClick: false, className: 'map-tooltip', offset: 14, anchor: 'bottom' });
    let hoveredId = null;
    function setHovered(id) {
        if (id === hoveredId) return;
        if (hoveredId) map.setFeatureState({ source: 'countries', id: hoveredId }, { hover: false });
        hoveredId = id;
        if (id) map.setFeatureState({ source: 'countries', id }, { hover: true });
    }
    const featureAt = point => map.queryRenderedFeatures(point, { layers: ['cities', 'city-dots', 'land'] })[0];
    map.on('mousemove', event => {
        const feature = featureAt(event.point);
        const town = feature && feature.layer.id !== 'land' ? feature : null;
        const country = feature?.layer.id === 'land' ? index.byId.get(feature.properties.id) : null;
        setHovered(country?.id || null);
        map.getCanvas().style.cursor = feature ? 'pointer' : '';
        const text = town ? town.properties.name : country ? `${country.flag} ${country.name}` : null;
        if (!text) {
            hoverTip.remove();
            return;
        }
        hoverTip.setLngLat(event.lngLat).setText(text);
        if (!hoverTip.isOpen()) hoverTip.addTo(map);
    });
    map.getCanvas().addEventListener('mouseleave', () => {
        setHovered(null);
        hoverTip.remove();
    });
    map.on('click', event => {
        hoverTip.remove();
        const feature = featureAt(event.point);
        if (!feature) return;
        if (feature.layer.id === 'land') {
            const country = index.byId.get(feature.properties.id);
            if (country) onCountryClick?.(country, event.lngLat);
            return;
        }
        // A town drawn on top of the country wins the click.
        onCityClick?.({ ...feature.properties, minZoom: feature.properties.minZoom + ZOOM_OFFSET });
    });

    // ---- the traveler's own pins

    let pins = [];
    function setPins(markers) {
        for (const pin of pins) pin.remove();
        pins = markers.filter(marker => marker.category === 'City').map(marker => {
            const pinElement = document.createElement('button');
            pinElement.type = 'button';
            pinElement.className = `pin pin-${marker.type}`;
            pinElement.title = marker.name;
            pinElement.setAttribute('aria-label', marker.name);
            const body = document.createElement('span');
            body.className = 'pin-body';
            const symbol = document.createElement('span');
            symbol.className = 'pin-symbol';
            symbol.textContent = marker.type === 'visited' ? '✓' : '♥';
            body.append(symbol);
            pinElement.append(body);
            pinElement.addEventListener('click', event => {
                event.stopPropagation();
                onPinClick?.(marker);
            });
            return new Marker({ element: pinElement, anchor: 'bottom' }).setLngLat([marker.lng, marker.lat]).addTo(map);
        });
    }

    // ---- cards and camera

    // Keep cards and fly targets clear of the floating top bar, side panel and legend.
    function safeArea() {
        const topbar = document.querySelector('.topbar');
        const panel = document.getElementById('panel');
        const narrow = window.innerWidth <= 760;
        return {
            top: (topbar ? topbar.getBoundingClientRect().bottom : 74) + 16,
            left: !panel || panel.hidden || narrow ? 40 : panel.getBoundingClientRect().right + 40,
            right: 40,
            bottom: 80
        };
    }

    let cardPopup = null;
    function openPopup(latlng, content, { offset = [0, -8] } = {}) {
        cardPopup?.remove();
        cardPopup = new Popup({ className: 'card-popup', maxWidth: '320px', anchor: 'bottom', offset: [offset[0], offset[1]], focusAfterOpen: false })
            .setLngLat(lngLat(latlng))
            .setDOMContent(content)
            .addTo(map);
        onPopupOpen?.();
        // Pan the card into view, clear of the panel and bars.
        requestAnimationFrame(() => {
            const card = cardPopup?.getElement()?.getBoundingClientRect();
            if (!card) return;
            const area = safeArea();
            const bounds = element.getBoundingClientRect();
            const dx = card.left < area.left ? card.left - area.left : card.right > bounds.right - area.right ? card.right - (bounds.right - area.right) : 0;
            const dy = card.top < area.top ? card.top - area.top : card.bottom > bounds.bottom - area.bottom ? card.bottom - (bounds.bottom - area.bottom) : 0;
            if (dx || dy) map.panBy([dx, dy], { duration: 300 });
        });
        return cardPopup;
    }

    function closePopup() {
        cardPopup?.remove();
        cardPopup = null;
    }

    // Resolves when the camera settles (or shortly after, if nothing moved).
    function afterMove() {
        return new Promise(resolve => {
            const done = () => {
                clearTimeout(timer);
                map.off('moveend', done);
                resolve();
            };
            const timer = setTimeout(done, 1600);
            map.once('moveend', done);
        });
    }

    function flyTo(lat, lng, zoom = 6) {
        const moved = afterMove();
        map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), toMapZoom(zoom)), padding: safeArea(), duration: 900 });
        return moved;
    }

    function flyToView([lat, lng], zoom) {
        const moved = afterMove();
        map.flyTo({ center: [lng, lat], zoom: toMapZoom(zoom), padding: safeArea(), duration: 900 });
        return moved;
    }

    function flyToCountry(country) {
        const moved = afterMove();
        const [minLng, minLat, maxLng, maxLat] = country.mainBounds;
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { maxZoom: toMapZoom(5.5), padding: safeArea(), duration: 900 });
        return moved;
    }

    // Follow the colour scheme.
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        theme = readTheme();
        ready.then(() => {
            map.setStyle(buildStyle(theme, countries, labels), { diff: true });
            map.once('styledata', () => {
                for (const [name, capital] of [['dot', false], ['dot-capital', true]]) {
                    if (map.hasImage(name)) map.updateImage(name, dotImage(theme, capital));
                    else map.addImage(name, dotImage(theme, capital), { pixelRatio: 2 });
                }
                applyStatus();
                updateCities();
            });
        });
    });

    return { map, setPins, setCountryStatus, flyToCountry, flyTo, flyToView, pulseCountry, openPopup, closePopup };
}
