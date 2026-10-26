// Journey lines on the map (ADR 0016): cartoon arcs between visits, and their animated replay,
// leg by leg, after framing them; and the open trip's itinerary, its stops numbered along a
// route. The arcs themselves are computed in journeys.js.
import { EMPTY, lineFeatures, toMapZoom } from './map-style.js';
import { journeyArc } from './journeys.js';

// Frames the given [lng, lat] points, clear of the panel and bars.
function fitPoints({ map, afterMove, safeArea }, points, duration) {
    const moved = afterMove();
    const lngs = points.map(([lng]) => lng);
    const lats = points.map(([, lat]) => lat);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { maxZoom: toMapZoom(6), padding: safeArea(), duration });
    return moved;
}

/**
 * Draws journey lines on `map` once `ready`, framing them with `afterMove` and `safeArea`
 * from the map module.
 * @param {{ map: any, ready: Promise<unknown>, afterMove: () => Promise<void>, safeArea: () => object }} options
 */
export function createJourneyLines({ map, ready, afterMove, safeArea }) {
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

    /**
     * Replays journey lines one after another, after framing them. With reduced motion, the
     * whole route is drawn at once. `onLeg(i)` tells which line is drawing; `onDone(finished)`
     * tells the replay ended, or was stopped. Returns a function that stops it.
     * @param {number[][][]} lines
     * @param {{ reduceMotion?: boolean, onLeg?: (leg: number) => void, onDone?: (finished: boolean) => void }} [options]
     */
    function replayJourneys(lines, { reduceMotion = false, onLeg, onDone } = {}) {
        stopReplay();
        if (!lines.length) {
            onDone?.(true);
            return () => {};
        }
        const framed = fitPoints({ map, afterMove, safeArea }, lines.flat(), reduceMotion ? 0 : 900);
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

    return { setJourneys, replayJourneys, redraw: () => drawLines(shownLines) };
}

/**
 * The open trip's stops on `map` once `ready`: numbered dots along a route, framed when the
 * stops change. `setItinerary(stops, focus)` takes `{ lat, lng }` stops (none hides it) and the
 * index of the stop to show bigger.
 * @param {{ map: any, ready: Promise<unknown>, afterMove: () => Promise<void>, safeArea: () => object }} options
 */
export function createItinerary(options) {
    const { map, ready } = options;
    let shown = [];
    let focused = -1;
    let framed = '';
    function draw() {
        map.getSource('itinerary')?.setData(lineFeatures(shown.slice(1).map((stop, i) => journeyArc(shown[i], stop))));
        map.getSource('itinerary-stops')?.setData({
            type: 'FeatureCollection',
            features: shown.map((stop, i) => ({
                type: 'Feature', geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] }, properties: { n: String(i + 1), focus: i === focused }
            }))
        });
    }
    function setItinerary(stops, focus = -1) {
        shown = stops;
        focused = focus;
        const key = JSON.stringify(stops.map(stop => [stop.lng, stop.lat]));
        ready.then(() => {
            draw();
            if (stops.length && key !== framed) fitPoints(options, stops.map(stop => [stop.lng, stop.lat]), 700);
            framed = stops.length ? key : '';
        });
    }
    return { setItinerary, redraw: () => ready.then(draw) };
}
