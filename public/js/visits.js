// Visits of a saved place: each one is a span of plain calendar dates (YYYY-MM-DD, no
// time zone) with optional notes and a photo link. Without an end date a visit is either
// still going on (`ongoing`) or its end was not recorded. Pure functions, unit tested in Node.
import { t, tk, tn } from './i18n.js';
import { companionsError, readCompanions } from './companions.js';

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

// How often the traveler has been, in the words of the place's status (ADR 0014).
const COUNT_WORDS = {
    visited: [tk('No visits recorded yet'), count => tn(count, 'Visited once', 'Visited {count} times')],
    lived: [tk('No dates recorded yet'), count => tn(count, 'Lived here once', 'Lived here {count} times')],
    transit: [tk('No layovers recorded yet'), count => tn(count, 'Passed through once', 'Passed through {count} times')]
};

export function visitCountLabel(count, status = 'visited') {
    const [none, times] = COUNT_WORDS[status] || COUNT_WORDS.visited;
    return count ? times(count) : t(none);
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
    if (!visit.endDate && visit.ongoing) return t('{date} – still there', { date: formatDate(visit.startDate) });
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
        ongoing: record?.ongoing === true || /^(on|true|yes|1)$/i.test(text(record?.ongoing)),
        companions: readCompanions(record?.companions)
    };
    if (!isValidDate(visit.startDate)) return { error: t('Choose the day the visit started.') };
    if (visit.endDate && !isValidDate(visit.endDate)) return { error: t('The end date is not a real date.') };
    if (visit.endDate && visit.ongoing) return { error: t('A visit you are still on has no last day yet.') };
    if (visit.endDate && visit.endDate < visit.startDate) return { error: t('The visit must end on or after the day it started.') };
    if (visit.notes.length > NOTES_MAX_LENGTH) return { error: t('Notes must be {NOTES_MAX_LENGTH} characters or fewer.', { NOTES_MAX_LENGTH }) };
    if (visit.photoUrl && (visit.photoUrl.length > PHOTO_URL_MAX_LENGTH || !isHttpUrl(visit.photoUrl))) {
        return { error: t('The photo link must be an HTTP or HTTPS address.') };
    }
    const error = companionsError(visit.companions);
    if (error) return { error };
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

/**
 * What checking in today does to a place's visits: nothing when one already covers today
 * (still going on, or ending today or later); `extend` the visit that ended yesterday to
 * today; otherwise `add` a one-day visit.
 */
export function checkInPlan(visits = [], today) {
    const yesterday = new Date(Date.parse(today) - DAY_MS).toISOString().slice(0, 10);
    const last = visit => visit.endDate || visit.startDate;
    const covers = visit => visit.startDate <= today && (last(visit) >= today || (visit.ongoing && !visit.endDate));
    if (visits.some(covers)) return { action: 'none' };
    const previous = visits.find(visit => last(visit) === yesterday);
    if (previous) return { action: 'extend', visit: { ...previous, endDate: today, ongoing: false } };
    return { action: 'add', visit: { startDate: today, endDate: today, notes: '', photoUrl: '', ongoing: false } };
}
