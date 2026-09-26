// Cartoon world map: country shapes and main cities only, no tiles or regional detail.
/* global L */

const WORLD_BOUNDS = [[-62, -200], [85, 200]];
const DEFAULT_VIEW = { center: [25, 10], zoom: 2.5 };

function cityMinZoom(city) {
    if (city.capital) return city.population >= 5e6 ? 3 : 4;
    if (city.rank <= 1) return 4;
    if (city.rank <= 4) return 5;
    return 6;
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

    // Main cities only: capitals first, bigger cities as you zoom in.
    const citiesLayer = L.layerGroup().addTo(map);
    const cityMarkers = cities.map(city => ({
        city,
        minZoom: cityMinZoom(city),
        marker: L.marker([city.lat, city.lng], {
            pane: 'cities',
            title: `${city.name}, ${city.country}`,
            keyboard: false,
            icon: L.divIcon({
                className: `city-marker${city.capital ? ' is-capital' : ''}`,
                html: `<span class="city-dot">${city.capital ? '★' : ''}</span><span class="city-name">${escapeText(city.name)}</span>`,
                iconSize: null,
                iconAnchor: [7, 7]
            })
        }).on('click', event => {
            L.DomEvent.stopPropagation(event);
            onCityClick?.(city);
        })
    }));

    // Show a label only where it does not collide with one already placed, biggest places first.
    const countryLabelOrder = [...labelMarkers].sort((a, b) =>
        (a.country.labelZoom || 5) - (b.country.labelZoom || 5) || b.country.population - a.country.population);
    const cityOrder = [...cityMarkers].sort((a, b) => b.city.capital - a.city.capital || b.city.population - a.city.population);

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

        // City dots always show, so they claim their spot first.
        const visibleCities = [];
        for (const entry of cityOrder) {
            const visible = zoom >= entry.minZoom;
            if (visible && !citiesLayer.hasLayer(entry.marker)) citiesLayer.addLayer(entry.marker);
            if (!visible && citiesLayer.hasLayer(entry.marker)) citiesLayer.removeLayer(entry.marker);
            if (!visible) continue;
            const point = map.project([entry.city.lat, entry.city.lng], zoom);
            placed.push([point.x - 8, point.y - 8, point.x + 8, point.y + 8]);
            visibleCities.push({ ...entry, point });
        }

        // Country names nudge up or down to dodge city dots, and hide if there is no room.
        for (const { country, marker } of countryLabelOrder) {
            const eligible = zoom >= Math.max(2.5, (country.labelZoom || 5) - 0.5) && zoom < 7;
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

        for (const { city, marker, point } of visibleCities) {
            const labelWidth = city.name.length * 7 + 6;
            // City-states (Monaco, Singapore…) already carry the country label.
            const showName = city.name !== city.country && claim(point.x + 9, point.y - 9, point.x + 10 + labelWidth, point.y + 9);
            marker.getElement()?.classList.toggle('no-label', !showName);
        }
    }

    map.on('zoomend', refreshZoomLayers);
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
