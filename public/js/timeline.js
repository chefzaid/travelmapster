// The map year by year (ADR 0016): the places a traveler had been to by the end of a year, or
// only those visited during it, from the plain calendar dates of their visits. Places without
// dates and wishlist places have no history, so they are left out. Pure, unit tested in Node.
import { statusOf } from './status.js';

export const TIME_MODES = [
    { id: 'by', label: 'Been by the end of' },
    { id: 'during', label: 'Visited during' }
];

// Visits of a place, falling back to the single travel date of older data.
function datedVisits(marker) {
    if (Array.isArray(marker.visits)) return marker.visits.filter(visit => visit?.startDate);
    return marker.travelDate ? [{ startDate: marker.travelDate }] : [];
}

/** The last day a visit covers: its end, today for a stay still going on, or its first day. */
export function visitLastDay(visit, today) {
    if (visit.endDate) return visit.endDate;
    if (visit.ongoing && today > visit.startDate) return today;
    return visit.startDate;
}

/** Whether a visit belongs on the map of `year`: started by its end, or overlapping it. */
export function visitInYear(visit, year, mode, today) {
    const first = `${year}-01-01`;
    const last = `${year}-12-31`;
    if (visit.startDate > last) return false;
    return mode !== 'during' || visitLastDay(visit, today) >= first;
}

/**
 * The years the timeline offers: from the first dated visit of a place been to up to this
 * year, or a later planned visit, starting at the year of the latest visit so far. Null when
 * nothing has a date yet.
 */
export function timelineYears(markers, today) {
    const thisYear = today.slice(0, 4);
    let first = '';
    let last = thisYear;
    let latest = '';
    for (const marker of markers) {
        if (statusOf(marker) === 'wishlist') continue;
        for (const visit of datedVisits(marker)) {
            const year = visit.startDate.slice(0, 4);
            if (!first || year < first) first = year;
            if (year > last) last = year;
            if (year <= thisYear && year > latest) latest = year;
        }
    }
    if (!first) return null;
    return { first: Number(first), last: Number(last), latest: Number(latest || first) };
}

/**
 * Places as they were by the end of `year` (mode `by`) or as visited during it (`during`),
 * each with only the visits that count. `undated` is how many places been to were left out
 * for having no dates, so the traveler can be told.
 */
export function placesInYear(markers, { year, mode = 'by', today }) {
    const kept = [];
    let undated = 0;
    for (const marker of markers) {
        if (statusOf(marker) === 'wishlist') continue;
        const visits = datedVisits(marker);
        if (!visits.length) {
            undated += 1;
            continue;
        }
        const shown = visits.filter(visit => visitInYear(visit, year, mode, today));
        if (shown.length) kept.push({ ...marker, visits: shown });
    }
    return { markers: kept, undated };
}
