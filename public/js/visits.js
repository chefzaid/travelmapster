// Visits of a saved place: each one is a span of plain calendar dates (YYYY-MM-DD, no
// time zone) with optional notes and a photo link. Without an end date a visit is either
// still going on (`ongoing`) or its end was not recorded. Pure functions, unit tested in Node.

const NOTES_MAX_LENGTH = 2000;
const PHOTO_URL_MAX_LENGTH = 2048;
const DAY_MS = 86_400_000;

export function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isHttpUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** Newest first: by start date, then the most recently added. */
export function sortVisits(visits = []) {
    return [...visits].sort((a, b) => b.startDate.localeCompare(a.startDate) || (b.id || 0) - (a.id || 0));
}

/** The date a place was last visited, falling back to the single travel date of older data. */
export function lastVisitDate(marker) {
    const visits = marker?.visits || [];
    if (!visits.length) return marker?.travelDate || '';
    return visits.reduce((latest, visit) => (visit.startDate > latest ? visit.startDate : latest), '');
}

export function visitCount(marker) {
    return marker?.visits?.length || 0;
}

export function visitCountLabel(count) {
    if (!count) return 'No visits recorded yet';
    if (count === 1) return 'Visited once';
    return `Visited ${count} times`;
}

/** Inclusive calendar days of a visit, or null when it has no end date. */
export function visitDays(visit) {
    if (!visit?.endDate) return null;
    const toDay = value => {
        const [year, month, day] = value.split('-').map(Number);
        return Date.UTC(year, month - 1, day) / DAY_MS;
    };
    return toDay(visit.endDate) - toDay(visit.startDate) + 1;
}

export function formatVisitDates(visit, formatDate) {
    if (!visit.endDate && visit.ongoing) return `${formatDate(visit.startDate)} – still there`;
    if (!visit.endDate || visit.endDate === visit.startDate) return formatDate(visit.startDate);
    return `${formatDate(visit.startDate)} – ${formatDate(visit.endDate)}`;
}

/** Validates a visit the way the API does; returns the clean visit or an error message. */
export function checkVisit(record) {
    const visit = {
        startDate: text(record?.startDate),
        endDate: text(record?.endDate),
        notes: text(record?.notes),
        photoUrl: text(record?.photoUrl),
        // A form checkbox sends "on"; CSV files say "yes".
        ongoing: record?.ongoing === true || /^(on|true|yes|1)$/i.test(text(record?.ongoing))
    };
    if (!isValidDate(visit.startDate)) return { error: 'Choose the day the visit started.' };
    if (visit.endDate && !isValidDate(visit.endDate)) return { error: 'The end date is not a real date.' };
    if (visit.endDate && visit.ongoing) return { error: 'A visit you are still on has no last day yet.' };
    if (visit.endDate && visit.endDate < visit.startDate) return { error: 'The visit must end on or after the day it started.' };
    if (visit.notes.length > NOTES_MAX_LENGTH) return { error: `Notes must be ${NOTES_MAX_LENGTH} characters or fewer.` };
    if (visit.photoUrl && (visit.photoUrl.length > PHOTO_URL_MAX_LENGTH || !isHttpUrl(visit.photoUrl))) {
        return { error: 'The photo link must be an HTTP or HTTPS address.' };
    }
    return { visit };
}

// Places-list filter by the year of the last visit: 'all', 'none' (no dated visit) or a year.
export function lastVisitYears(markers) {
    const years = new Set(markers.map(lastVisitDate).filter(Boolean).map(date => date.slice(0, 4)));
    return [...years].sort((a, b) => b.localeCompare(a));
}

export function matchesLastVisit(marker, filter) {
    if (!filter || filter === 'all') return true;
    const date = lastVisitDate(marker);
    if (filter === 'none') return !date;
    return date.startsWith(`${filter}-`);
}
