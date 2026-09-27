// Cartoon world map: country shapes and every town, no map tiles or regional detail.
/* global L */
import { createCityLayer } from './city-layer.js';

const WORLD_BOUNDS = [[-62, -200], [85, 200]];
const DEFAULT_VIEW = { center: [25, 10], zoom: 2.5 };
const COUNTRY_LABELS_MAX_ZOOM = 7;

// The build grades every place with the zoom at which its name fits beside the places
// shown before it (see scripts/build-map-data.js), so each zoom step adds more.
function cityMinZoom(city) {
    return Number.isFinite(city.minZoom) ? city.minZoom : 6;
}

function escapeText(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

export function createTravelMap(element, { index, cities, onCountryClick, onCityClick, onPinClick }) {
    const map = L.map(element, {
        minZoom: 2,
        maxZoom: 11,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 90,
        maxBounds: WORLD_BOUNDS,
        maxBoundsViscosity: 0.8,
        worldCopyJump: false,
        zoomControl: false,
        attributionControl: true,
        preferCanvas: false
    }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.attributionControl.addAttribution('Borders: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a>'
        + ' · Places: <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)');
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    map.createPane('graticule').style.zIndex = 250;
    map.createPane('countries').style.zIndex = 300;
    map.createPane('countryLabels').style.zIndex = 420;
    map.createPane('cities').style.zIndex = 450;
    map.getPane('countryLabels').style.pointerEvents = 'none';

    // A few fun reference lines, drawn like a school atlas.
    const graticule = L.layerGroup().addTo(map);
    [
        { lat: 0, name: 'Equator' },
        { lat: 23.44, name: 'Tropic of Cancer' },
        { lat: -23.44, name: 'Tropic of Capricorn' }
    ].forEach(({ lat, name }) => {
        L.polyline([[lat, -180], [lat, 180]], { pane: 'graticule', className: 'graticule-line', interactive: false }).addTo(graticule);
        L.marker([lat, -168], {
            pane: 'graticule',
            interactive: false,
            icon: L.divIcon({ className: 'graticule-label', html: escapeText(name), iconSize: null })
        }).addTo(graticule);
    });

    const renderer = L.svg({ pane: 'countries', padding: 0.5 });
    const countryLayers = new Map();
    const hoverTooltip = L.tooltip({ className: 'country-tooltip', direction: 'top', offset: [0, -8], sticky: true });
    let hoveredCountry = null;

    const countriesLayer = L.geoJSON(index.countries.map(country => country.feature), {
        renderer,
        pane: 'countries',
        style: feature => ({
            className: `country c${feature.properties.color || 1}`,
            weight: 1.4,
            lineJoin: 'round',
            lineCap: 'round'
        }),
        onEachFeature: (feature, layer) => {
            const country = index.byId.get(feature.properties.id);
            countryLayers.set(country.id, layer);
            layer.on({
                mouseover: () => {
                    layer.getElement()?.classList.add('is-hover');
                    hoveredCountry = country;
                },
                mouseout: () => {
                    layer.getElement()?.classList.remove('is-hover');
                    hoveredCountry = null;
                    updateHover(null);
                },
                click: event => {
                    L.DomEvent.stopPropagation(event);
                    map.closeTooltip(hoverTooltip);
                    // A town drawn on top of the country wins the click.
                    const city = cityLayer.cityAt(event.containerPoint);
                    if (city) onCityClick?.(city);
                    else onCountryClick?.(country, event.latlng);
                }
            });
        }
    }).addTo(map);

    // Country name labels appear as you zoom in, biggest countries first.
    const labelsLayer = L.layerGroup().addTo(map);
    const labelMarkers = index.countries.map(country => ({
        country,
        marker: L.marker(country.label, {
            pane: 'countryLabels',
            interactive: false,
            keyboard: false,
            icon: L.divIcon({ className: 'country-label', html: `<span>${escapeText(country.name)}</span>`, iconSize: null })
        })
    }));

    // Capitals first, then ever smaller places as you zoom in. The base list arrives with
    // the page; smaller places load in region tiles just before their zoom is reached.
    const VIEW_PADDING = 0.1;
    const cityLayer = createCityLayer(map, { pane: 'cities', padding: VIEW_PADDING });
    const toEntry = city => ({ city, minZoom: cityMinZoom(city) });
    const baseEntries = cities.map(toEntry);
    const tiles = new Map();

    fetch('data/cities/index.json')
        .then(response => (response.ok ? response.json() : []))
        .then(list => {
            for (const { id, bounds, minZoom } of list) {
                tiles.set(id, { bounds: L.latLngBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]), minZoom, entries: null, loading: false });
            }
            scheduleRefresh();
        })
        .catch(() => {});

    function loadTiles(view, zoom) {
        for (const [id, tile] of tiles) {
            // Fetch half a zoom early so places are ready when they are due.
            if (tile.entries || tile.loading || zoom < tile.minZoom - 0.5 || !tile.bounds.intersects(view)) continue;
            tile.loading = true;
            fetch(`data/cities/${id}.json`)
                .then(response => {
                    if (!response.ok) throw new Error(`City tile ${id}: HTTP ${response.status}`);
                    return response.json();
                })
                .then(rows => {
                    tile.entries = rows.map(([name, countryId, capital, population, minZoom, lat, lng]) => toEntry({
                        name, country: index.byId.get(countryId)?.name || '', countryId, capital, population, minZoom, lat, lng
                    }));
                    scheduleRefresh();
                })
                .catch(() => { tile.loading = false; });
        }
    }

    // Show a label only where it does not collide with one already placed, biggest places first.
    const countryLabelOrder = [...labelMarkers].sort((a, b) =>
        (a.country.labelZoom || 5) - (b.country.labelZoom || 5) || b.country.population - a.country.population);
    // Capitals first; other places in the order they appear, so a name shown at one zoom
    // keeps its place as you zoom further in and new places only fill the space around it.
    const cityOrder = (a, b) => b.city.capital - a.city.capital
        || (a.city.capital ? 0 : a.minZoom - b.minZoom) || b.city.population - a.city.population;

    // Collision boxes in a spatial grid, so placing thousands of labels stays fast.
    function createPlacement(cell = 128) {
        const cells = new Map();
        const each = (x1, y1, x2, y2, visit) => {
            for (let cx = Math.floor(x1 / cell); cx <= Math.floor(x2 / cell); cx++) {
                for (let cy = Math.floor(y1 / cell); cy <= Math.floor(y2 / cell); cy++) visit(`${cx},${cy}`);
            }
        };
        return {
            add(x1, y1, x2, y2) {
                each(x1, y1, x2, y2, key => (cells.get(key) || cells.set(key, []).get(key)).push([x1, y1, x2, y2]));
            },
            claim(x1, y1, x2, y2) {
                let free = true;
                each(x1, y1, x2, y2, key => {
                    if (free) free = !(cells.get(key) || []).some(([a1, b1, a2, b2]) => x1 < a2 && x2 > a1 && y1 < b2 && y2 > b1);
                });
                if (free) this.add(x1, y1, x2, y2);
                return free;
            }
        };
    }

    function refreshZoomLayers() {
        const zoom = map.getZoom();
        element.dataset.zoom = String(Math.floor(zoom));
        element.classList.toggle('is-deep', zoom >= COUNTRY_LABELS_MAX_ZOOM);
        const fontSize = zoom >= 6 ? 16 : zoom >= 4 ? 14 : 12;
        const placement = createPlacement();
        const claim = (x1, y1, x2, y2) => placement.claim(x1, y1, x2, y2);

        // Only places in (or just around) the view are rendered.
        const view = map.getBounds().pad(VIEW_PADDING);
        loadTiles(view, zoom);
        const inView = [baseEntries, ...[...tiles.values()].filter(tile => tile.entries && tile.bounds.intersects(view)).map(tile => tile.entries)]
            .flatMap(entries => entries.filter(entry => zoom >= entry.minZoom && view.contains([entry.city.lat, entry.city.lng])))
            .sort(cityOrder)
            .map(entry => ({ entry, city: entry.city, point: map.project([entry.city.lat, entry.city.lng], zoom) }));
        // A name goes right of its dot, or left when the right side is taken.
        const nameWidth = city => city.name.length * 7 + 6;
        const placeName = ({ city, point }, withDot) => {
            const [top, bottom, dot] = [point.y - 9, point.y + 9, withDot ? 8 : -9];
            if (claim(point.x - dot, top, point.x + 10 + nameWidth(city), bottom)) return 'right';
            if (claim(point.x - 10 - nameWidth(city), top, point.x + dot, bottom)) return 'left';
            return null;
        };
        const labelled = new Map();

        // Capital dots always show, so they claim their spot first.
        const capitals = inView.filter(({ city }) => city.capital);
        for (const { point } of capitals) placement.add(point.x - 8, point.y - 8, point.x + 8, point.y + 8);

        // Capitals name themselves where there is room. City-states such as Monaco or
        // Singapore already carry the country label while country labels are shown.
        for (const item of capitals) {
            const namedByCountry = item.city.name === item.city.country && zoom < COUNTRY_LABELS_MAX_ZOOM;
            labelled.set(item.entry, namedByCountry ? null : placeName(item, false));
        }

        // Country names nudge up or down to dodge capitals, and hide if there is no room.
        for (const { country, marker } of countryLabelOrder) {
            const eligible = zoom >= Math.max(2.5, (country.labelZoom || 5) - 0.5) && zoom < COUNTRY_LABELS_MAX_ZOOM;
            let offset = null;
            if (eligible) {
                const point = map.project(country.label, zoom);
                const halfWidth = (country.name.length * fontSize * 0.56) / 2 + 4;
                const halfHeight = fontSize * 0.7;
                offset = [0, fontSize + 4, -(fontSize + 4)].find(dy =>
                    claim(point.x - halfWidth, point.y + dy - halfHeight, point.x + halfWidth, point.y + dy + halfHeight)
                ) ?? null;
            }
            const visible = offset !== null;
            if (visible && !labelsLayer.hasLayer(marker)) labelsLayer.addLayer(marker);
            if (!visible && labelsLayer.hasLayer(marker)) labelsLayer.removeLayer(marker);
            if (visible) marker.getElement()?.style.setProperty('--dy', `${offset}px`);
        }

        // Other places appear with their name, in the order they first appear. At the
        // deepest zoom every place shows, as a dot when its name has no room.
        const deepest = zoom >= map.getMaxZoom();
        for (const item of inView) {
            if (item.city.capital) continue;
            const side = placeName(item, true);
            if (side || deepest) labelled.set(item.entry, side);
        }

        // Towns first, capitals last so they are drawn on top.
        cityLayer.draw([...labelled]
            .sort(([a], [b]) => a.city.capital - b.city.capital)
            .map(([entry, side]) => ({ city: entry.city, latlng: [entry.city.lat, entry.city.lng], side })));
    }

    // One hover handler for the whole map: a town under the pointer shows its name,
    // otherwise the hovered country does.
    function updateHover(event) {
        const city = event ? cityLayer.cityAt(event.containerPoint) : null;
        map.getContainer().classList.toggle('is-over-city', Boolean(city));
        const content = city ? escapeText(city.name) : hoveredCountry ? `${hoveredCountry.flag} ${escapeText(hoveredCountry.name)}` : null;
        if (!content || !event) {
            map.closeTooltip(hoverTooltip);
            return;
        }
        hoverTooltip.setContent(content).setLatLng(event.latlng);
        if (!map.hasLayer(hoverTooltip)) map.openTooltip(hoverTooltip);
    }
    map.on('mousemove', updateHover);
    map.on('mouseout', () => updateHover(null));
    map.on('click', event => {
        const city = cityLayer.cityAt(event.containerPoint);
        if (city) onCityClick?.(city);
    });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        cityLayer.refreshColors();
        refreshZoomLayers();
    });
    document.fonts?.ready.then(() => refreshZoomLayers());

    // Relabel once the map settles: running between wheel steps or during a drag would
    // stall the next animation frame. Arriving city tiles trigger the same refresh.
    let refreshTimer = 0;
    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => requestAnimationFrame(refreshZoomLayers), 90);
    }
    map.on('moveend', scheduleRefresh);
    map.on('movestart zoomstart', () => clearTimeout(refreshTimer));
    refreshZoomLayers();

    // The user's own city pins.
    const pinsLayer = L.layerGroup().addTo(map);
    const pinMarkers = new Map();

    function pinIcon(marker) {
        const symbol = marker.type === 'visited' ? '✓' : '♥';
        return L.divIcon({
            className: `pin pin-${marker.type}`,
            html: `<span class="pin-body"><span class="pin-symbol">${symbol}</span></span>`,
            iconSize: [30, 38],
            iconAnchor: [15, 36],
            popupAnchor: [0, -32]
        });
    }

    function setPins(markers) {
        pinsLayer.clearLayers();
        pinMarkers.clear();
        for (const marker of markers) {
            if (marker.category !== 'City') continue;
            const pin = L.marker([marker.lat, marker.lng], {
                icon: pinIcon(marker),
                title: marker.name,
                riseOnHover: true,
                zIndexOffset: marker.type === 'visited' ? 200 : 100
            }).on('click', event => {
                L.DomEvent.stopPropagation(event);
                onPinClick?.(marker);
            });
            pinsLayer.addLayer(pin);
            pinMarkers.set(String(marker.id), pin);
        }
    }

    function setCountryStatus({ visitedIds, wishlistIds, cityOnlyIds }, filter = 'all') {
        for (const [id, layer] of countryLayers) {
            const path = layer.getElement();
            if (!path) continue;
            const visited = visitedIds.has(id) && filter !== 'wishlist';
            const wishlist = wishlistIds.has(id) && filter !== 'visited';
            path.classList.toggle('is-visited', visited);
            path.classList.toggle('is-wishlist', wishlist);
            path.classList.toggle('is-city-only', visited && cityOnlyIds.has(id));
        }
    }

    // Resolves when the current map animation finishes (or shortly after, if nothing moved).
    function afterMove() {
        return new Promise(resolve => {
            const done = () => {
                clearTimeout(timer);
                map.off('moveend', done);
                resolve();
            };
            const timer = setTimeout(done, 1400);
            map.once('moveend', done);
        });
    }

    function countryBounds(country) {
        const [minLng, minLat, maxLng, maxLat] = country.mainBounds;
        return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
    }

    function flyToCountry(country) {
        const moved = afterMove();
        map.flyToBounds(countryBounds(country), { maxZoom: 5.5, paddingTopLeft: panelPadding(), paddingBottomRight: [60, 60], duration: 0.8 });
        return moved;
    }

    function flyTo(lat, lng, zoom = 6) {
        const moved = afterMove();
        const target = Math.max(map.getZoom(), zoom);
        // Offset the center so the place is not hidden behind the side panel.
        const [padX] = panelPadding();
        const point = map.project([lat, lng], target).subtract([padX / 2 - 30, 0]);
        map.flyTo(map.unproject(point, target), target, { duration: 0.8 });
        return moved;
    }

    function panelPadding() {
        const panel = document.getElementById('panel');
        if (!panel || panel.hidden || window.innerWidth <= 760) return [40, 90];
        return [panel.getBoundingClientRect().right + 40, 90];
    }

    function pulseCountry(countryId) {
        const path = countryLayers.get(countryId)?.getElement();
        if (!path) return;
        path.classList.remove('is-pulsing');
        // Restart the CSS animation.
        void path.getBoundingClientRect();
        path.classList.add('is-pulsing');
        setTimeout(() => path.classList.remove('is-pulsing'), 1200);
    }

    // Keep cards clear of the floating top bar and side panel, and of the legend below.
    function popupPadding() {
        const topbar = document.querySelector('.topbar');
        const top = topbar ? topbar.getBoundingClientRect().bottom + 16 : 90;
        return { autoPanPaddingTopLeft: [panelPadding()[0], top], autoPanPaddingBottomRight: [40, 80] };
    }

    function openPopup(latlng, content, options = {}) {
        return L.popup({ className: 'card-popup', maxWidth: 320, minWidth: 260, ...popupPadding(), ...options })
            .setLatLng(latlng)
            .setContent(content)
            .openOn(map);
    }

    function resetView() {
        map.flyTo(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { duration: 0.8 });
    }

    // Keep Leaflet's size in sync with the responsive layout.
    new ResizeObserver(() => map.invalidateSize()).observe(element);

    return {
        map,
        countriesLayer,
        setPins,
        setCountryStatus,
        flyToCountry,
        flyTo,
        pulseCountry,
        openPopup,
        closePopup: () => map.closePopup(),
        resetView,
        pinFor: id => pinMarkers.get(String(id))
    };
}
