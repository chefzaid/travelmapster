// Cartoon world map: country shapes and cities, no tiles or regional detail.
/* global L */

const WORLD_BOUNDS = [[-62, -200], [85, 200]];
const DEFAULT_VIEW = { center: [25, 10], zoom: 2.5 };
const COUNTRY_LABELS_MAX_ZOOM = 7;

// Natural Earth grades each place with the zoom at which it earns a label, so more
// cities appear at every zoom step; capitals keep their early appearance.
function cityMinZoom(city) {
    const graded = Number.isFinite(city.minZoom) ? city.minZoom : 6;
    if (city.capital) return Math.min(graded, city.population >= 5e6 ? 3 : 4);
    return Math.max(3, graded);
}

function escapeText(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

export function createTravelMap(element, { index, cities, onCountryClick, onCityClick, onPinClick }) {
    const map = L.map(element, {
        minZoom: 2,
        maxZoom: 8,
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
    map.attributionControl.addAttribution('Borders &amp; cities: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a>');
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
                mouseover: event => {
                    layer.getElement()?.classList.add('is-hover');
                    hoverTooltip.setContent(`${country.flag} ${escapeText(country.name)}`).setLatLng(event.latlng);
                    map.openTooltip(hoverTooltip);
                },
                mousemove: event => hoverTooltip.setLatLng(event.latlng),
                mouseout: () => {
                    layer.getElement()?.classList.remove('is-hover');
                    map.closeTooltip(hoverTooltip);
                },
                click: event => {
                    L.DomEvent.stopPropagation(event);
                    map.closeTooltip(hoverTooltip);
                    onCountryClick?.(country, event.latlng);
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

    // Capitals first, then smaller cities as you zoom in. Markers are created on first
    // use because most of the thousands of places are never on screen.
    const citiesLayer = L.layerGroup().addTo(map);
    const cityMarker = entry => entry.marker ??= L.marker([entry.city.lat, entry.city.lng], {
        pane: 'cities',
        title: `${entry.city.name}, ${entry.city.country}`,
        keyboard: false,
        icon: L.divIcon({
            className: `city-marker${entry.city.capital ? ' is-capital' : ''}`,
            html: `<span class="city-dot">${entry.city.capital ? '★' : ''}</span><span class="city-name">${escapeText(entry.city.name)}</span>`,
            iconSize: null,
            iconAnchor: [7, 7]
        })
    }).on('click', event => {
        L.DomEvent.stopPropagation(event);
        onCityClick?.(entry.city);
    });
    const cityMarkers = cities.map((city, index) => ({ city, index, minZoom: cityMinZoom(city), marker: null }));
    // Natural Earth puts many places on the same zoom; spread each group over the half
    // zoom before it, biggest first, so cities keep appearing gradually.
    const zoomGroups = Map.groupBy(cityMarkers.filter(entry => !entry.city.capital), entry => entry.minZoom);
    for (const [zoom, group] of zoomGroups) {
        group.sort((a, b) => b.city.population - a.city.population);
        group.forEach((entry, rank) => { entry.minZoom = Math.max(3, zoom - 0.5 * (1 - rank / group.length)); });
    }

    // Show a label only where it does not collide with one already placed, biggest places first.
    const countryLabelOrder = [...labelMarkers].sort((a, b) =>
        (a.country.labelZoom || 5) - (b.country.labelZoom || 5) || b.country.population - a.country.population);
    // Capitals first; other cities in the order they appear, so a name shown at one zoom
    // keeps its place as you zoom further in and new cities only fill the space around it.
    const cityOrder = [...cityMarkers].sort((a, b) => b.city.capital - a.city.capital
        || (a.city.capital ? 0 : a.minZoom - b.minZoom) || b.city.population - a.city.population);

    function refreshZoomLayers() {
        const zoom = map.getZoom();
        element.dataset.zoom = String(Math.floor(zoom));
        const fontSize = zoom >= 6 ? 16 : zoom >= 4 ? 14 : 12;
        const placed = [];
        const claim = (x1, y1, x2, y2) => {
            if (placed.some(([a1, b1, a2, b2]) => x1 < a2 && x2 > a1 && y1 < b2 && y2 > b1)) return false;
            placed.push([x1, y1, x2, y2]);
            return true;
        };

        // Only places in (or just around) the view are rendered.
        const view = map.getBounds().pad(0.25);
        const inView = cityOrder.filter(entry => zoom >= entry.minZoom && view.contains([entry.city.lat, entry.city.lng]))
            .map(entry => ({ ...entry, point: map.project([entry.city.lat, entry.city.lng], zoom) }));
        // A name goes right of its dot, or left when the right side is taken.
        const nameWidth = city => city.name.length * 7 + 6;
        const placeName = ({ city, point }, withDot) => {
            const [top, bottom, dot] = [point.y - 9, point.y + 9, withDot ? 8 : -9];
            if (claim(point.x - dot, top, point.x + 10 + nameWidth(city), bottom)) return 'right';
            if (claim(point.x - 10 - nameWidth(city), top, point.x + dot, bottom)) return 'left';
            return null;
        };
        const shown = new Set();

        // Capital dots always show, so they claim their spot first.
        const capitals = inView.filter(({ city }) => city.capital);
        for (const { point } of capitals) placed.push([point.x - 8, point.y - 8, point.x + 8, point.y + 8]);

        // Capitals name themselves where there is room. City-states such as Monaco or
        // Singapore already carry the country label while country labels are shown.
        const labelled = new Map();
        for (const entry of capitals) {
            const namedByCountry = entry.city.name === entry.city.country && zoom < COUNTRY_LABELS_MAX_ZOOM;
            labelled.set(entry, namedByCountry ? null : placeName(entry, false));
            shown.add(entry);
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

        // Other cities appear only with their name, in the order they first appear, so
        // zooming in makes room for more of them.
        for (const entry of inView) {
            if (entry.city.capital) continue;
            const side = placeName(entry, true);
            if (side) {
                labelled.set(entry, side);
                shown.add(entry);
            }
        }

        const shownMarkers = new Set();
        for (const entry of shown) {
            const marker = cityMarker(cityMarkers[entry.index]);
            shownMarkers.add(marker);
            if (!citiesLayer.hasLayer(marker)) citiesLayer.addLayer(marker);
            const element = marker.getElement();
            element?.classList.toggle('no-label', !labelled.get(entry));
            element?.classList.toggle('label-left', labelled.get(entry) === 'left');
        }
        for (const marker of citiesLayer.getLayers()) {
            if (!shownMarkers.has(marker)) citiesLayer.removeLayer(marker);
        }
    }

    // Panning brings new places into view, so refresh after every move, not just zooms.
    map.on('moveend', refreshZoomLayers);
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

    function openPopup(latlng, content, options = {}) {
        return L.popup({ className: 'card-popup', maxWidth: 320, minWidth: 260, autoPanPadding: [40, 40], ...options })
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
