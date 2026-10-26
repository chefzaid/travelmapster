// Itineraries: their stops, and the trip outside the app: as text, as an iCalendar file with an
// all-day event per day, as a template copy without dates, and as planned stays in the day
// ledger. Pure, unit tested in Node.
import { locale, t, tk } from './i18n.js';

export const SLOTS = [
    ['morning', '🌅', tk('Morning')],
    ['afternoon', '☀️', tk('Afternoon')],
    ['evening', '🌙', tk('Evening')]
];

const TITLE_MAX_LENGTH = 120;

export function emptyDay() {
    return { morning: '', afternoon: '', evening: '' };
}

function shiftDate(startDate, offset) {
    const [year, month, day] = startDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + offset));
}

const isoDate = (startDate, offset) => (startDate ? shiftDate(startDate, offset).toISOString().slice(0, 10) : '');

/**
 * Where the trip goes, stop by stop: `{ destination, firstDay, days, startDate, endDate }` with
 * day numbers from 0 and dates when the trip has a start date. A trip without stops has one,
 * its destination. Stops take the plan's days in turn; the last one takes the days left.
 */
export function tripStops(trip) {
    const total = trip.plan.length;
    const listed = trip.stops?.length ? trip.stops : [{ destination: trip.destination, days: total }];
    const stops = [];
    let firstDay = 0;
    listed.forEach((stop, i) => {
        if (firstDay >= total) return;
        const days = i === listed.length - 1 ? total - firstDay : Math.min(stop.days, total - firstDay);
        stops.push({
            destination: stop.destination, firstDay, days,
            startDate: isoDate(trip.startDate, firstDay), endDate: isoDate(trip.startDate, firstDay + days - 1)
        });
        firstDay += days;
    });
    return stops;
}

/** The stop a day of the trip (from 0) belongs to. */
export function stopOfDay(trip, day) {
    return tripStops(trip).find(stop => day >= stop.firstDay && day < stop.firstDay + stop.days);
}

/** "Lisbon → Madrid", or the destination of a trip without stops. */
export function tripRoute(trip) {
    return trip.stops?.length ? trip.stops.map(stop => stop.destination).join(' → ') : trip.destination;
}

/** "Mon, Jun 2" for day `offset` of a trip, or '' without a start date. */
export function dayDate(startDate, offset) {
    if (!startDate) return '';
    return shiftDate(startDate, offset).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The trip's last day (YYYY-MM-DD), or '' without a start date. */
export function tripEndDate(trip) {
    return isoDate(trip.startDate, trip.plan.length - 1);
}

export function tripAsText(trip) {
    const lines = [`${trip.title} (${tripRoute(trip)})`, ''];
    const several = trip.stops?.length > 1;
    trip.plan.forEach((day, i) => {
        const date = dayDate(trip.startDate, i);
        lines.push([t('Day {number}', { number: i + 1 }), date, several ? stopOfDay(trip, i).destination : ''].filter(Boolean).join(', '));
        for (const [slot, , label] of SLOTS) {
            if (day[slot]) lines.push(`  ${t(label)}: ${day[slot]}`);
        }
        lines.push('');
    });
    return lines.join('\n').trim();
}

/** A copy to plan another trip from: same days, plans and packing list, no dates or expenses. */
export function tripTemplate(trip) {
    const suffix = ' (copy)';
    return {
        title: `${trip.title.slice(0, TITLE_MAX_LENGTH - suffix.length)}${suffix}`,
        destination: trip.destination,
        startDate: '',
        plan: trip.plan.map(day => Object.fromEntries(SLOTS.map(([slot]) => [slot, day[slot] || '']))),
        stops: (trip.stops || []).map(({ destination, days }) => ({ destination, days })),
        // The list to pack again, and the budget's currency and plan without what was spent.
        packing: (trip.packing || []).map(entry => ({ item: entry.item, packed: false })),
        budget: trip.budget?.currency ? { currency: trip.budget.currency, planned: trip.budget.planned ?? null, rates: {}, expenses: [] } : {}
    };
}

// ---------------------------------------------------------------- day ledger

/**
 * Where a destination such as "Japan", "Lisbon, Portugal" or "Kyoto" is: `{ country }` when it
 * names a country, `{ city, countryId }` for a town of that name (in the country named after
 * it, if any), else `{ country }` for a country named last; null when nothing matches.
 */
export function resolveDestination(destination, { findCountry, findCity }) {
    const parts = String(destination ?? '').split(',').map(part => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    const whole = parts.join(', ');
    const country = findCountry(whole);
    if (country) return { country, countryId: country.id };
    const city = findCity(whole);
    if (city) return { city, countryId: city.countryId };
    const last = parts.length > 1 ? findCountry(parts.at(-1)) : null;
    return last ? { country: last, countryId: last.id } : null;
}

/** The id of the ledger's (first) planned stay that follows a trip. */
export const tripPlanId = trip => `trip-${trip.id}`;

/** Whether a planned stay of the ledger follows this trip: its first, or one for a later country. */
export const isTripPlan = (trip, id) => id === tripPlanId(trip) || String(id).startsWith(`${tripPlanId(trip)}-`);

/**
 * The ledger's planned stays for a dated trip: one per country in turn, from `countryOf(stop
 * destination)`. A day spent going from one country to the next ends one stay and starts the
 * next, as the ledger counts days under its "any part of a day" rule. `{ stays }`, or
 * `{ unknown }` with the first destination in no known country; no stays without a start date.
 */
export function tripPlannedStays(trip, countryOf) {
    if (!trip.startDate) return { stays: [] };
    const stays = [];
    for (const stop of tripStops(trip)) {
        const countryId = countryOf(stop.destination);
        if (!countryId) return { unknown: stop.destination };
        const last = stays.at(-1);
        if (last?.countryId === countryId) last.endDate = stop.endDate;
        else {
            if (last) last.endDate = stop.startDate;
            stays.push({ id: stays.length ? `${tripPlanId(trip)}-${stays.length + 1}` : tripPlanId(trip), countryId, startDate: stop.startDate, endDate: stop.endDate });
        }
    }
    return { stays };
}

/**
 * The planned stays once a trip changed: its stays follow the new dates and countries, in the
 * place of the old ones, or go when the trip has none any more (or was deleted, with `stays`
 * empty). Null when the trip is not planned in the ledger or nothing changes.
 */
export function syncPlannedStays(planned, trip, stays) {
    const own = planned.filter(item => isTripPlan(trip, item.id));
    if (!own.length) return null;
    const same = (a, b) => ['id', 'countryId', 'startDate', 'endDate'].every(key => a[key] === b[key]);
    if (own.length === stays.length && own.every((item, i) => same(item, stays[i]))) return null;
    const at = planned.findIndex(item => isTripPlan(trip, item.id));
    const rest = planned.filter(item => !isTripPlan(trip, item.id));
    return [...rest.slice(0, at), ...stays, ...rest.slice(at)];
}

// ---------------------------------------------------------------- iCalendar (RFC 5545)

const escapeText = value => String(value)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const compactDate = date => date.toISOString().slice(0, 10).replace(/-/g, '');

// Lines longer than 75 octets continue on the next line after a space, never inside a character.
function fold(line) {
    const encoder = new TextEncoder();
    const parts = [];
    let current = '';
    let size = 0;
    for (const character of line) {
        const length = encoder.encode(character).length;
        if (size + length > (parts.length ? 74 : 75)) {
            parts.push(current);
            current = '';
            size = 0;
        }
        current += character;
        size += length;
    }
    parts.push(current);
    return parts.join('\r\n ');
}

/**
 * An iCalendar file with an all-day event for each day of the trip, holding that day's plans.
 * Needs a start date; `now` stamps the events.
 */
export function tripCalendar(trip, now = new Date()) {
    if (!trip.startDate) return { error: t('Choose a start date to add this trip to a calendar.') };
    const stamp = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TravelMapster//Itinerary//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(trip.title)}`
    ];
    trip.plan.forEach((day, i) => {
        const plans = SLOTS.filter(([slot]) => day[slot]).map(([slot, , label]) => `${t(label)}: ${day[slot]}`);
        lines.push(
            'BEGIN:VEVENT',
            `UID:trip-${trip.id ?? 'new'}-${trip.startDate}-day-${i + 1}@travelmapster`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${compactDate(shiftDate(trip.startDate, i))}`,
            `DTEND;VALUE=DATE:${compactDate(shiftDate(trip.startDate, i + 1))}`,
            `SUMMARY:${escapeText(`${t('Day {number}', { number: i + 1 })}: ${trip.title}`)}`,
            `LOCATION:${escapeText(stopOfDay(trip, i).destination)}`,
            ...(plans.length ? [`DESCRIPTION:${escapeText(plans.join('\n'))}`] : []),
            'TRANSP:TRANSPARENT',
            'END:VEVENT'
        );
    });
    lines.push('END:VCALENDAR');
    return { calendar: `${lines.map(fold).join('\r\n')}\r\n` };
}

/** A file name from the trip title, such as "summer-in-portugal.ics". */
export function tripFileName(trip, extension) {
    const slug = trip.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return `${slug || 'trip'}.${extension}`;
}
