// The map's look: colours from the CSS design tokens, town dots, status patterns, journey
// arrows and the MapLibre style built from them, for the light and dark themes and every palette.
import { t } from './i18n.js';

// The app and its data use Leaflet-scale zooms; MapLibre's are one lower for the same scale.
export const ZOOM_OFFSET = 1;
export const MAX_ZOOM = 11;
const COUNTRY_LABELS_MAX_ZOOM = 7;
// Whole countries light up on hover only at world scale; up close they fill the screen.
const HOVER_FILL_MAX_ZOOM = 7;
export const DEFAULT_VIEW = { center: [10, 25], zoom: 2.5 };

export const toMapZoom = zoom => zoom - ZOOM_OFFSET;
export const lngLat = point => (Array.isArray(point) ? [point[1], point[0]] : [point.lng, point.lat]);
export const dataUrl = file => new URL(`../data/${file}`, import.meta.url);
const fontUrl = file => new URL(`../vendor/fonts/${file}`, import.meta.url).href;

// Colours come from the CSS design tokens, so the map follows the light and dark themes.
export function readTheme() {
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
export function dotImage(theme, capital) {
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
export function patternImage(colour, kind) {
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

export const PATTERNS = [['pattern-lived', 'livedInk', 'stripes'], ['pattern-home', 'homeInk', 'dots']];

// The arrow in the middle of each journey line, pointing the way the traveler went.
export function arrowImage(theme) {
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

export const EMPTY = { type: 'FeatureCollection', features: [] };
export const lineFeatures = lines => ({
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
export const STATUS_LAYERS = {
    'lived-pattern': ['lived'],
    'home-pattern': ['home'],
    'borders-visited': ['visited', 'cityOnly'],
    'borders-lived': ['lived'],
    'borders-home': ['home'],
    'borders-transit': ['transit'],
    'borders-wishlist': ['wishlist']
};
export const onlyCountries = ids => ['in', ['get', 'id'], ['literal', ids]];

const statusBorder = (id, colour, width, extra = {}) => ({
    id, type: 'line', source: 'countries', filter: onlyCountries([]), layout: { 'line-join': 'round', ...extra.layout },
    paint: { 'line-color': colour, 'line-width': width, ...extra.paint }
});

export function buildStyle(theme, countries, labels) {
    const atlasLines = [
        { lat: 0, name: t('Equator') },
        { lat: 23.44, name: t('Tropic of Cancer') },
        { lat: -23.44, name: t('Tropic of Capricorn') }
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
            'journey-head': { type: 'geojson', data: EMPTY },
            itinerary: { type: 'geojson', data: EMPTY },
            'itinerary-stops': { type: 'geojson', data: EMPTY }
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
            // The open trip's route: a solid line between its numbered stops, the chosen one bigger.
            {
                id: 'itinerary-casing', type: 'line', source: 'itinerary', layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': theme.journeyCasing, 'line-width': 8, 'line-opacity': 0.9 }
            },
            {
                id: 'itinerary-route', type: 'line', source: 'itinerary', layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': theme.capital, 'line-width': 4 }
            },
            {
                id: 'itinerary-stops', type: 'circle', source: 'itinerary-stops',
                paint: {
                    'circle-radius': ['case', ['get', 'focus'], 15, 11], 'circle-color': theme.capital,
                    'circle-stroke-color': theme.journeyCasing, 'circle-stroke-width': 3
                }
            },
            {
                id: 'itinerary-numbers', type: 'symbol', source: 'itinerary-stops',
                layout: {
                    'text-field': ['get', 'n'], 'text-font': ['Fredoka SemiBold'], 'text-size': 13,
                    'text-allow-overlap': true, 'text-ignore-placement': true
                },
                paint: { 'text-color': '#fff' }
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
