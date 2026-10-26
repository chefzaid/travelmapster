// Cartoon world map drawn on the GPU with MapLibre GL: country shapes and every town,
// with smooth, continuous zooming. See docs/adr/0008-maplibre-gl.md.
import { Map as MapLibreMap, Marker, Popup } from '../vendor/maplibre/maplibre-gl.mjs';
import { ALL_STATUSES_SHOWN, countryLook } from './geo.js';
import { statusInfo, statusOf } from './status.js';
import {
    DEFAULT_VIEW, MAX_ZOOM, PATTERNS, STATUS_LAYERS, ZOOM_OFFSET, arrowImage, buildStyle, dataUrl, dotImage, lngLat,
    onlyCountries, patternImage, readTheme, toMapZoom
} from './map-style.js';
import { createItinerary, createJourneyLines } from './map-journeys.js';

/**
 * The travel map in `element`, drawing `index` countries and `cities`; the callbacks get clicks
 * on a country, a town or a pin, and the opening of a card.
 * @param {HTMLElement & { travelMap?: unknown }} element
 * @param {{ index: any, cities: any[], onCountryClick: Function, onCityClick: Function, onPinClick: Function, onPopupOpen?: Function }} options
 */
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
            /** @type {Array<[string, string, () => void]>} */
            const buttons = [['Zoom in', '+', () => map.zoomIn()], ['Zoom out', '−', () => map.zoomOut()]];
            for (const [label, text, action] of buttons) {
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
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let cityTimer;
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
    // The pointer can move over the map before its style has these layers.
    const featureAt = point => {
        const layers = ['cities', 'city-dots', 'land'].filter(id => map.getLayer(id));
        return layers.length ? map.queryRenderedFeatures(point, { layers })[0] : undefined;
    };
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
        return new Promise(/** @param {(value?: void) => void} resolve */ resolve => {
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

    const journeys = createJourneyLines({ map, ready, afterMove, safeArea });
    const itinerary = createItinerary({ map, ready, afterMove, safeArea });

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
                journeys.redraw();
                itinerary.redraw();
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
        setJourneys: journeys.setJourneys, replayJourneys: journeys.replayJourneys, setItinerary: itinerary.setItinerary,
        refreshTheme, snapshot
    };
}
