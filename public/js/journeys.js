// Journey lines (ADR 0016): every dated visit in the order it happened, joined by cartoon
// arcs, and grouped into trips to replay. Pure, unit tested in Node.
import { visitLastDay } from './timeline.js';

const DAY_MS = 86_400_000;
// Days between leaving one place and reaching the next that still make one trip.
export const TRIP_GAP_DAYS = 3;

const dayNumber = date => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
};

const overlaps = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;

/**
 * Stops in the order they happened: one per visit, at the city, or at the country's label
 * point for a visit to a whole country. A country visit that overlaps a city visit in the same
 * country adds no stop, as the city says more, and back-to-back visits to one place are one
 * stop. Visits on the same first day go shortest first, so a layover comes before the stay.
 */
export function journeyStops(markers, { countryOf, today }) {
    const stops = [];
    for (const marker of markers) {
        const country = countryOf(marker);
        const city = marker.category === 'City';
        const [lat, lng] = !city && country?.label ? country.label : [Number(marker.lat), Number(marker.lng)];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const name = String(marker.name || '').split(',')[0].trim();
        for (const visit of marker.visits || []) {
            if (!visit?.startDate) continue;
            stops.push({
                markerId: marker.id, name, countryId: country?.id || null, city, lat, lng,
                startDate: visit.startDate, endDate: visitLastDay(visit, today)
            });
        }
    }
    const cityStops = stops.filter(stop => stop.city);
    const kept = stops.filter(stop => stop.city
        || !cityStops.some(cityStop => cityStop.countryId === stop.countryId && overlaps(cityStop, stop)));
    kept.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.markerId - b.markerId);
    const merged = [];
    for (const stop of kept) {
        const previous = merged[merged.length - 1];
        if (previous?.markerId === stop.markerId) {
            if (stop.endDate > previous.endDate) previous.endDate = stop.endDate;
        } else {
            merged.push({ ...stop });
        }
    }
    return merged;
}

/** A leg for each pair of consecutive stops at different points. */
export function journeyLegs(stops) {
    const legs = [];
    for (let i = 1; i < stops.length; i += 1) {
        const from = stops[i - 1];
        const to = stops[i];
        if (from.lat !== to.lat || from.lng !== to.lng) legs.push({ from, to });
    }
    return legs;
}

/**
 * Trips: runs of stops with at most `gapDays` days between leaving the last place and reaching
 * the next. Only runs of two stops or more are trips.
 */
export function groupTrips(stops, gapDays = TRIP_GAP_DAYS) {
    const runs = [];
    let current = null;
    for (const stop of stops) {
        if (!current || dayNumber(stop.startDate) - dayNumber(current.endDate) > gapDays) {
            current = { stops: [], startDate: stop.startDate, endDate: stop.endDate };
            runs.push(current);
        }
        current.stops.push(stop);
        if (stop.endDate > current.endDate) current.endDate = stop.endDate;
    }
    return runs.filter(run => journeyLegs(run.stops).length > 0);
}

/**
 * A cartoon arc from one stop to the next, as [lng, lat] points: a curve that bulges to the
 * left of the direction of travel, so a return trip draws its own arc beside the way out.
 */
export function journeyArc(from, to, segments = 32) {
    const dx = to.lng - from.lng;
    const dy = to.lat - from.lat;
    const bend = 0.2;
    const control = [(from.lng + to.lng) / 2 - dy * bend, (from.lat + to.lat) / 2 + dx * bend];
    const round = value => Math.round(value * 1e4) / 1e4;
    const points = [];
    for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const a = (1 - t) ** 2;
        const b = 2 * (1 - t) * t;
        const c = t ** 2;
        const lng = a * from.lng + b * control[0] + c * to.lng;
        const lat = a * from.lat + b * control[1] + c * to.lat;
        points.push([round(lng), round(Math.max(-85, Math.min(85, lat)))]);
    }
    return points;
}

/** "Lisbon → Porto → Madrid", shortened in the middle for long routes. */
export function routeLabel(stops, max = 5) {
    const names = [];
    for (const { name } of stops) {
        if (names[names.length - 1] !== name) names.push(name);
    }
    if (names.length <= max) return names.join(' → ');
    return [...names.slice(0, max - 2), '…', names[names.length - 1]].join(' → ');
}
