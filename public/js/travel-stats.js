// Passport statistics from dated visits: days away from home per year, the longest trip, the
// approximate distance traveled and countries per year. Pure, unit tested in Node.
import { dayNumber, isoDay } from './days.js';
import { groupRuns, journeyLegs, journeyStops, routeLabel } from './journeys.js';
import { statusOf } from './status.js';

const EARTH_RADIUS_KM = 6371;
export const EARTH_CIRCUMFERENCE_KM = 40_075;

/** Great-circle distance between two { lat, lng } points, in kilometers. */
export function distanceKm(from, to) {
    const radians = degrees => (degrees * Math.PI) / 180;
    const dLat = radians(to.lat - from.lat);
    const dLng = radians(to.lng - from.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Days up to today spent in any country but home (every recorded day without one), per year. */
export function daysAwayByYear(ledger, homeId, today) {
    const last = dayNumber(today);
    const days = new Set();
    for (const [countryId, countryDays] of ledger.countries) {
        if (countryId === homeId) continue;
        for (const day of countryDays.keys()) if (day <= last) days.add(day);
    }
    const years = new Map();
    for (const day of days) {
        const year = isoDay(day).slice(0, 4);
        years.set(year, (years.get(year) || 0) + 1);
    }
    return [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, count]) => ({ year, count }));
}

const runDays = run => dayNumber(run.endDate) - dayNumber(run.startDate) + 1;

/**
 * The longest trip: consecutive stays away from home (layovers included, places lived in and
 * wishes left out) with at most a few days between them, one stay or several.
 */
export function longestTrip(markers, { countryOf, homeId, today }) {
    const away = markers.filter(marker => ['visited', 'transit'].includes(statusOf(marker)));
    const stops = journeyStops(away, { countryOf, today }).filter(stop => !homeId || stop.countryId !== homeId);
    let longest = null;
    for (const run of groupRuns(stops)) {
        const days = runDays(run);
        if (!longest || days > longest.days) longest = { startDate: run.startDate, endDate: run.endDate, days, route: routeLabel(run.stops) };
    }
    return longest;
}

/** Straight-line kilometers between every place been to, in the order of the visits. */
export function distanceTraveled(markers, { countryOf, today }) {
    const been = markers.filter(marker => statusOf(marker) !== 'wishlist');
    const legs = journeyLegs(journeyStops(been, { countryOf, today }));
    return Math.round(legs.reduce((total, { from, to }) => total + distanceKm(from, to), 0));
}

/**
 * Countries visited or lived in each year (layovers are not visits), counted on the chosen list,
 * and how many of them were new that year.
 */
export function countriesByYear(markers, { countryOf, countedIds }) {
    const byYear = new Map();
    for (const marker of markers) {
        if (!['visited', 'lived'].includes(statusOf(marker))) continue;
        const id = countryOf(marker)?.id;
        if (!id || (countedIds && !countedIds.has(id))) continue;
        for (const visit of marker.visits || []) {
            const year = visit.startDate.slice(0, 4);
            if (!byYear.has(year)) byYear.set(year, new Set());
            byYear.get(year).add(id);
        }
    }
    const seen = new Set();
    return [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, ids]) => {
        const fresh = [...ids].filter(id => !seen.has(id));
        for (const id of ids) seen.add(id);
        return { year, count: ids.size, newCount: fresh.length };
    });
}
