// Draws city dots and names on one canvas instead of hundreds of DOM markers, which keeps
// zooming and panning smooth however many towns are on screen. The canvas scales with
// Leaflet's zoom animation and is redrawn crisply once the map settles.
/* global L */

const DOT_RADIUS = 6;
const CAPITAL_RADIUS = 8;

function readColors() {
    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
        outline: read('--ink', '#1f3b57'),
        text: read('--ink-dark', '#1f3b57'),
        capital: read('--primary-strong', '#c93636')
    };
}

const fontFor = capital => `800 ${capital ? 12.5 : 11.5}px Nunito, ui-rounded, system-ui, sans-serif`;

export function createCityLayer(map, { pane, padding }) {
    const canvas = L.DomUtil.create('canvas', 'city-canvas leaflet-zoom-animated', map.getPane(pane));
    const context = canvas.getContext('2d');
    let colors = readColors();
    let drawn = { items: [], bounds: null, zoom: null, origin: null };
    let hitGrid = new Map();
    const HIT_CELL = 64;

    // Keep the last drawing aligned while Leaflet animates or jumps to another zoom.
    function align(zoom, center) {
        if (!drawn.bounds) return;
        const scale = map.getZoomScale(zoom, drawn.zoom);
        const offset = map._latLngBoundsToNewLayerBounds(drawn.bounds, zoom, center).min;
        L.DomUtil.setTransform(canvas, offset, scale);
    }
    map.on('zoomanim', event => align(event.zoom, event.center));
    map.on('zoom viewreset', () => align(map.getZoom(), map.getCenter()));

    function indexHit(item) {
        const [x1, y1, x2, y2] = item.hitBox;
        for (let cx = Math.floor(x1 / HIT_CELL); cx <= Math.floor(x2 / HIT_CELL); cx++) {
            for (let cy = Math.floor(y1 / HIT_CELL); cy <= Math.floor(y2 / HIT_CELL); cy++) {
                const key = `${cx},${cy}`;
                (hitGrid.get(key) || hitGrid.set(key, []).get(key)).push(item);
            }
        }
    }

    /**
     * Draws places given as { city, latlng, side } where side is 'right', 'left' or null
     * (dot only). Coordinates are kept in layer space for hit-testing until the next draw.
     */
    function draw(items) {
        const size = map.getSize();
        const pad = size.multiplyBy(padding).round();
        const topLeft = map.containerPointToLayerPoint(pad.multiplyBy(-1));
        const width = size.x + pad.x * 2;
        const height = size.y + pad.y * 2;
        const ratio = window.devicePixelRatio || 1;

        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        L.DomUtil.setTransform(canvas, topLeft, 1);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.textBaseline = 'middle';
        context.lineJoin = 'round';

        hitGrid = new Map();
        const placed = [];
        for (const item of items) {
            const layerPoint = map.latLngToLayerPoint(item.latlng);
            const x = layerPoint.x - topLeft.x;
            const y = layerPoint.y - topLeft.y;
            const capital = Boolean(item.city.capital);
            const radius = capital ? CAPITAL_RADIUS : DOT_RADIUS;

            context.beginPath();
            context.arc(x, y, radius - 1.25, 0, Math.PI * 2);
            context.fillStyle = capital ? colors.capital : '#fff';
            context.fill();
            context.lineWidth = 2.5;
            context.strokeStyle = colors.outline;
            context.stroke();
            if (capital) {
                context.font = '9px system-ui, sans-serif';
                context.textAlign = 'center';
                context.fillStyle = '#fff';
                context.fillText('★', x, y + 0.5);
            }

            let hitBox = [layerPoint.x - radius, layerPoint.y - radius, layerPoint.x + radius, layerPoint.y + radius];
            if (item.side) {
                context.font = fontFor(capital);
                const textWidth = context.measureText(item.city.name).width;
                const left = item.side === 'right' ? x + radius + 4 : x - radius - 4 - textWidth;
                context.textAlign = 'left';
                // A white outline halo keeps names readable on every land colour.
                context.lineWidth = 4;
                context.strokeStyle = '#fff';
                context.strokeText(item.city.name, left, y);
                context.fillStyle = colors.text;
                context.fillText(item.city.name, left, y);
                const layerLeft = left + topLeft.x;
                hitBox = [Math.min(hitBox[0], layerLeft), layerPoint.y - 9, Math.max(hitBox[2], layerLeft + textWidth), layerPoint.y + 9];
            }
            const placedItem = { city: item.city, hitBox };
            placed.push(placedItem);
            indexHit(placedItem);
        }
        drawn = { items: placed, bounds: L.latLngBounds(map.layerPointToLatLng(topLeft), map.layerPointToLatLng(topLeft.add([width, height]))), zoom: map.getZoom() };
    }

    /** The place drawn under a container point, if the drawing is current. */
    function cityAt(containerPoint) {
        if (drawn.zoom !== map.getZoom()) return null;
        const { x, y } = map.containerPointToLayerPoint(containerPoint);
        const candidates = hitGrid.get(`${Math.floor(x / HIT_CELL)},${Math.floor(y / HIT_CELL)}`) || [];
        // Later items were drawn on top, so they win.
        for (let i = candidates.length - 1; i >= 0; i--) {
            const [x1, y1, x2, y2] = candidates[i].hitBox;
            if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return candidates[i].city;
        }
        return null;
    }

    function refreshColors() {
        colors = readColors();
    }

    return { draw, cityAt, refreshColors };
}
