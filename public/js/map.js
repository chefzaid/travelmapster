// Cartoon world map drawn on the GPU with MapLibre GL: country shapes and every town,
// with smooth, continuous zooming. See docs/adr/0008-maplibre-gl.md.
import { Map as MapLibreMap, Marker, Popup } from '../vendor/maplibre/maplibre-gl.mjs';
import { ALL_STATUSES_SHOWN, countryLook } from './geo.js';
import { statusInfo, statusOf } from './status.js';

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
        visitedHover: token('--visited-hover'),
        wishlist: token('--wishlist'),
        wishlistInk: token('--wishlist-ink'),
        wishlistHover: token('--wishlist-hover'),
        lived: token('--lived'),
        livedInk: token('--lived-ink'),
        home: token('--home'),
        homeInk: token('--home-ink'),
        transit: token('--transit'),
        transitInk: token('--transit-ink'),
        capital: token('--primary-strong'),
        graticule: token('--graticule'),
        atlasLine: token('--atlas-line'),
        journey: token('--journey'),
        journeyCasing: token('--journey-casing'),
        ocean: token('--ocean'),
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

// Patterns over lived-in countries (stripes) and the home country (dots), so the statuses
// differ by more than colour (ADR 0014).
function patternImage(colour, kind) {
    const ratio = 2;
    const size = 10;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.fillStyle = colour;
    context.strokeStyle = colour;
    if (kind === 'dots') {
        context.beginPath();
        context.arc(size / 2, size / 2, 1.8, 0, Math.PI * 2);
        context.fill();
    } else {
        context.lineWidth = 1.6;
        context.lineCap = 'square';
        context.beginPath();
        // A diagonal that tiles seamlessly, with its corners.
        for (const offset of [-size, 0, size]) {
            context.moveTo(offset, size);
            context.lineTo(offset + size, 0);
        }
        context.stroke();
    }
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

const PATTERNS = [['pattern-lived', 'livedInk', 'stripes'], ['pattern-home', 'homeInk', 'dots']];

// The arrow in the middle of each journey line, pointing the way the traveler went.
function arrowImage(theme) {
    const ratio = 2;
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.beginPath();
    context.moveTo(4, 3);
    context.lineTo(12, 8);
    context.lineTo(4, 13);
    context.closePath();
    context.lineJoin = 'round';
    context.lineWidth = 3;
    context.strokeStyle = theme.journeyCasing;
    context.stroke();
    context.fillStyle = theme.journey;
    context.fill();
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

const EMPTY = { type: 'FeatureCollection', features: [] };
const lineFeatures = lines => ({
    type: 'FeatureCollection',
    features: lines.map(coordinates => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }))
});

const state = name => ['boolean', ['feature-state', name], false];
// A country's status (see countryLook in geo.js), or '' when it has none.
const look = ['to-string', ['feature-state', 'status']];
const lookIs = (...names) => ['in', look, ['literal', names]];

function countryFill(theme) {
    const land = ['match', ['get', 'color'], ...theme.land.flatMap((colour, i) => [i + 1, colour]), theme.land[0]];
    const status = ['match', look,
        'home', theme.home,
        'lived', theme.lived,
        'visited', theme.visited,
        'cityOnly', theme.visitedSoft,
        'transit', theme.transit,
        'wishlist', theme.wishlist,
        land];
    const hovered = ['case',
        ['!', state('hover')], status,
        lookIs('visited', 'cityOnly'), theme.visitedHover,
        lookIs('wishlist'), theme.wishlistHover,
        lookIs('home', 'lived', 'transit'), status,
        '#fff'];
    return ['step', ['zoom'], hovered, toMapZoom(HOVER_FILL_MAX_ZOOM), status];
}

// Layers drawn only for countries with some statuses. Their filters list those countries, so
// the GPU never draws an outline or pattern for the rest (see applyStatus).
const STATUS_LAYERS = {
    'lived-pattern': ['lived'],
    'home-pattern': ['home'],
    'borders-visited': ['visited', 'cityOnly'],
    'borders-lived': ['lived'],
    'borders-home': ['home'],
    'borders-transit': ['transit'],
    'borders-wishlist': ['wishlist']
};
const onlyCountries = ids => ['in', ['get', 'id'], ['literal', ids]];

const statusBorder = (id, colour, width, extra = {}) => ({
    id, type: 'line', source: 'countries', filter: onlyCountries([]), layout: { 'line-join': 'round', ...extra.layout },
    paint: { 'line-color': colour, 'line-width': width, ...extra.paint }
});

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
            cities: { type: 'geojson', data: EMPTY },
            journeys: { type: 'geojson', data: EMPTY },
            'journey-head': { type: 'geojson', data: EMPTY }
        },
        layers: [
            // No background layer: the dotted ocean is the container's CSS background.
            {
                id: 'atlas-lines', type: 'line', source: 'atlas', filter: ['==', ['geometry-type'], 'LineString'],
                layout: { 'line-cap': 'round' },
                paint: { 'line-color': theme.atlasLine, 'line-width': 1.5, 'line-dasharray': [0.5, 5] }
            },
            {
                id: 'land-shadow', type: 'fill', source: 'countries',
                paint: { 'fill-color': theme.shadow, 'fill-opacity': 0.28, 'fill-translate': [3, 4] }
            },
            { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': countryFill(theme) } },
            {
                id: 'lived-pattern', type: 'fill', source: 'countries', filter: onlyCountries([]),
                paint: { 'fill-pattern': 'pattern-lived', 'fill-opacity': 0.55 }
            },
            {
                id: 'home-pattern', type: 'fill', source: 'countries', filter: onlyCountries([]),
                paint: { 'fill-pattern': 'pattern-home', 'fill-opacity': 0.6 }
            },
            {
                // Countries picked for marking several at once: a tint over their status color.
                id: 'selected-fill', type: 'fill', source: 'countries',
                paint: { 'fill-color': theme.capital, 'fill-opacity': ['case', state('selected'), 0.4, 0] }
            },
            {
                id: 'borders', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: { 'line-color': theme.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 1.8, 10, 2.4] }
            },
            // Each status has its own outline: solid, thick, dashed or dotted.
            statusBorder('borders-visited', theme.visitedInk, 2),
            statusBorder('borders-lived', theme.livedInk, 2.5),
            statusBorder('borders-home', theme.homeInk, 3.5),
            statusBorder('borders-transit', theme.transitInk, 2.5, { layout: { 'line-cap': 'round' }, paint: { 'line-dasharray': [0.1, 2] } }),
            statusBorder('borders-wishlist', theme.wishlistInk, 2, { paint: { 'line-dasharray': [2.5, 2] } }),
            {
                id: 'borders-hover', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: { 'line-color': theme.ink, 'line-width': 2.5, 'line-opacity': ['case', state('hover'), 1, 0] }
            },
            {
                id: 'borders-selected', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: { 'line-color': theme.capital, 'line-width': 3.5, 'line-opacity': ['case', state('selected'), 1, 0] }
            },
            {
                id: 'borders-pulse', type: 'line', source: 'countries', layout: { 'line-join': 'round' },
                paint: {
                    'line-color': theme.capital,
                    'line-width': ['*', 7, ['number', ['feature-state', 'pulse'], 0]],
                    'line-opacity': ['number', ['feature-state', 'pulse'], 0]
                }
            },
            // Journey lines between visits (ADR 0016): a dashed path on a light casing, with an arrow.
            {
                id: 'journey-casing', type: 'line', source: 'journeys', layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': theme.journeyCasing, 'line-width': 7, 'line-opacity': 0.9 }
            },
            {
                id: 'journey-lines', type: 'line', source: 'journeys', layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': theme.journey, 'line-width': 3, 'line-dasharray': [1.6, 1.4] }
            },
            {
                id: 'journey-arrows', type: 'symbol', source: 'journeys',
                layout: {
                    'symbol-placement': 'line-center', 'icon-image': 'journey-arrow',
                    'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map'
                }
            },
            {
                id: 'journey-head', type: 'circle', source: 'journey-head',
                paint: { 'circle-radius': 7, 'circle-color': theme.journey, 'circle-stroke-color': theme.journeyCasing, 'circle-stroke-width': 3 }
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
    // Town dots and status patterns, drawn from the theme and redrawn when it changes.
    function images() {
        return [
            ['dot', dotImage(theme, false)],
            ['dot-capital', dotImage(theme, true)],
            ['journey-arrow', arrowImage(theme)],
            ...PATTERNS.map(([name, colour, kind]) => [name, patternImage(theme[colour], kind)])
        ];
    }
    ready.then(() => {
        for (const [name, image] of images()) map.addImage(name, image, { pixelRatio: 2 });
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

    const empty = new Set();
    let status = { visitIds: empty, livedIds: empty, transitIds: empty, wishlistIds: empty, cityOnlyIds: empty, homeId: null };
    let shown = ALL_STATUSES_SHOWN;
    let filterKeys = new Map();
    function applyStatus() {
        const byLook = new Map();
        for (const country of index.countries) {
            const value = countryLook(country.id, status, shown) || '';
            map.setFeatureState({ source: 'countries', id: country.id }, { status: value });
            if (!byLook.has(value)) byLook.set(value, []);
            byLook.get(value).push(country.id);
        }
        // A new filter re-tiles its layer, so only changed ones are set.
        for (const [layer, looks] of Object.entries(STATUS_LAYERS)) {
            const ids = looks.flatMap(name => byLook.get(name) || []);
            const key = ids.join();
            if (filterKeys.get(layer) === key) continue;
            filterKeys.set(layer, key);
            map.setFilter(layer, onlyCountries(ids));
        }
    }
    /** Colors countries by status (see countryStatus in geo.js), showing only the statuses in `visible`. */
    function setCountryStatus(next, visible = ALL_STATUSES_SHOWN) {
        status = next;
        shown = visible;
        ready.then(applyStatus);
    }

    // Countries picked for a bulk change.
    let selectedIds = new Set();
    function applySelection(previous = new Set()) {
        for (const id of previous) {
            if (!selectedIds.has(id)) map.setFeatureState({ source: 'countries', id }, { selected: false });
        }
        for (const id of selectedIds) map.setFeatureState({ source: 'countries', id }, { selected: true });
    }
    function setSelection(ids) {
        const previous = selectedIds;
        selectedIds = new Set(ids);
        ready.then(() => applySelection(previous));
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

    // Pins by what they show, so a pin that stays (as the timeline moves) is not drawn again.
    let pins = new Map();
    function setPins(markers) {
        const next = new Map();
        for (const marker of markers) {
            if (marker.category !== 'City') continue;
            const info = statusInfo(statusOf(marker));
            const key = [marker.id, info.id, marker.emoji || '', marker.name, marker.lat, marker.lng].join('|');
            if (pins.has(key)) {
                next.set(key, pins.get(key));
                pins.delete(key);
            } else {
                next.set(key, createPin(marker, info));
            }
        }
        for (const pin of pins.values()) pin.marker.remove();
        pins = next;
    }

    function createPin(marker, info) {
        const pinElement = document.createElement('button');
        pinElement.type = 'button';
        // The traveler's emoji replaces the status symbol; the pin's colour still tells the status.
        pinElement.className = `pin pin-${info.id}${marker.emoji ? ' pin-emoji' : ''}`;
        pinElement.title = marker.name;
        pinElement.setAttribute('aria-label', `${marker.name}, ${info.label.toLowerCase()}`);
        const body = document.createElement('span');
        body.className = 'pin-body';
        const symbol = document.createElement('span');
        symbol.className = 'pin-symbol';
        symbol.textContent = marker.emoji || info.pin;
        body.append(symbol);
        pinElement.append(body);
        pinElement.addEventListener('click', event => {
            event.stopPropagation();
            onPinClick?.(marker);
        });
        const pin = new Marker({ element: pinElement, anchor: 'bottom' }).setLngLat([marker.lng, marker.lat]).addTo(map);
        return { marker: pin, element: pinElement };
    }

    // ---- cards and camera

    // Keep cards and fly targets clear of the floating top bar, side panel and legend.
    function safeArea() {
        const topbar = document.querySelector('.topbar');
        const panel = document.getElementById('panel');
        const legend = document.getElementById('legend');
        const timeBar = document.getElementById('time-bar');
        const narrow = window.innerWidth <= 760;
        // On phones the legend sits under the top bar.
        const top = Math.max(topbar ? topbar.getBoundingClientRect().bottom : 74, narrow && legend ? legend.getBoundingClientRect().bottom : 0);
        // The timeline sits over the bottom of the map.
        const bottom = timeBar && !timeBar.hidden
            ? Math.max(80, element.getBoundingClientRect().bottom - timeBar.getBoundingClientRect().top + 16)
            : 80;
        return {
            top: top + 16,
            left: !panel || panel.hidden || narrow ? 40 : panel.getBoundingClientRect().right + 40,
            right: 40,
            bottom
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

    // ---- journey lines and their replay (ADR 0016)

    let shownLines = [];
    let replay = null;
    function drawLines(lines) {
        shownLines = lines;
        ready.then(() => map.getSource('journeys')?.setData(lineFeatures(lines)));
    }
    function drawHead(point) {
        ready.then(() => map.getSource('journey-head')?.setData(point
            ? { type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: {} }
            : EMPTY));
    }

    function stopReplay() {
        if (!replay) return;
        cancelAnimationFrame(replay.frame);
        const { onDone } = replay;
        replay = null;
        drawHead(null);
        onDone?.(false);
    }

    /** Draws journey lines, each a list of [lng, lat] points; an empty list hides them. */
    function setJourneys(lines) {
        stopReplay();
        drawLines(lines);
    }

    // Frames the given [lng, lat] points, clear of the panel and bars.
    function fitPoints(points, duration) {
        const moved = afterMove();
        const lngs = points.map(([lng]) => lng);
        const lats = points.map(([, lat]) => lat);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { maxZoom: toMapZoom(6), padding: safeArea(), duration });
        return moved;
    }

    /**
     * Replays journey lines one after another, after framing them. With reduced motion, the
     * whole route is drawn at once. `onLeg(i)` tells which line is drawing; `onDone(finished)`
     * tells the replay ended, or was stopped. Returns a function that stops it.
     */
    function replayJourneys(lines, { reduceMotion = false, onLeg, onDone } = {}) {
        stopReplay();
        if (!lines.length) {
            onDone?.(true);
            return () => {};
        }
        const framed = fitPoints(lines.flat(), reduceMotion ? 0 : 900);
        if (reduceMotion) {
            drawLines(lines);
            onLeg?.(lines.length - 1);
            onDone?.(true);
            return () => {};
        }
        const current = { frame: 0, onDone };
        replay = current;
        drawLines([]);
        const legTime = Math.max(400, Math.min(1000, 20_000 / lines.length));
        framed.then(() => {
            if (replay !== current) return;
            let leg = 0;
            let started = performance.now();
            onLeg?.(0);
            const frame = now => {
                if (replay !== current) return;
                const t = Math.min(Math.max((now - started) / legTime, 0), 1);
                const line = lines[leg];
                const partial = t > 0 ? line.slice(0, Math.max(2, Math.ceil(t * (line.length - 1)) + 1)) : null;
                drawLines(partial ? [...lines.slice(0, leg), partial] : lines.slice(0, leg));
                drawHead(partial ? partial[partial.length - 1] : line[0]);
                if (t >= 1) {
                    leg += 1;
                    if (leg >= lines.length) {
                        replay = null;
                        drawHead(null);
                        onDone?.(true);
                        return;
                    }
                    // A short stop at each place before the next leg.
                    started = now + 300;
                    onLeg?.(leg);
                }
                current.frame = requestAnimationFrame(frame);
            };
            current.frame = requestAnimationFrame(frame);
        });
        return () => {
            if (replay === current) stopReplay();
        };
    }

    // ---- theme, palettes and printing

    /** Redraws the map from the CSS tokens, after a change of colour scheme or palette. */
    function refreshTheme() {
        theme = readTheme();
        ready.then(() => {
            map.setStyle(buildStyle(theme, countries, labels), { diff: true });
            map.once('styledata', () => {
                for (const [name, image] of images()) {
                    if (map.hasImage(name)) map.updateImage(name, image);
                    else map.addImage(name, image, { pixelRatio: 2 });
                }
                filterKeys = new Map();
                applyStatus();
                applySelection();
                updateCities();
                drawLines(shownLines);
            });
        });
    }
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', refreshTheme);

    /**
     * A picture of the map as shown, for printing: the ocean, everything MapLibre draws and the
     * traveler's pins, which are page elements rather than part of the canvas.
     */
    function snapshot() {
        // A synchronous render keeps the WebGL drawing buffer readable without preserving it.
        map.redraw();
        const source = map.getCanvas();
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        context.fillStyle = theme.ocean;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0);
        const ratio = source.width / (source.clientWidth || source.width);
        context.scale(ratio, ratio);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = '900 12px system-ui, sans-serif';
        for (const { marker, element: pin } of pins.values()) {
            const { x, y } = map.project(marker.getLngLat());
            const body = getComputedStyle(pin.querySelector('.pin-body'));
            context.beginPath();
            context.arc(x, y - 16, 11, 0, Math.PI * 2);
            context.fillStyle = body.backgroundColor;
            context.fill();
            context.lineWidth = 2.5;
            context.strokeStyle = theme.ink;
            context.stroke();
            const symbol = pin.querySelector('.pin-symbol');
            context.fillStyle = getComputedStyle(symbol).color;
            context.fillText(symbol.textContent, x, y - 15.5);
        }
        return canvas.toDataURL('image/png');
    }

    return {
        map, setPins, setCountryStatus, setSelection, flyToCountry, flyTo, flyToView, pulseCountry, openPopup, closePopup,
        setJourneys, replayJourneys, refreshTheme, snapshot
    };
}
