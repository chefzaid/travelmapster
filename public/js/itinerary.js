// Itineraries outside the app: as text, as an iCalendar file with an all-day event per day,
// and as a template copy without dates. Pure, unit tested in Node.

export const SLOTS = [
    ['morning', '🌅', 'Morning'],
    ['afternoon', '☀️', 'Afternoon'],
    ['evening', '🌙', 'Evening']
];

const TITLE_MAX_LENGTH = 120;

function shiftDate(startDate, offset) {
    const [year, month, day] = startDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + offset));
}

/** "Mon, Jun 2" for day `offset` of a trip, or '' without a start date. */
export function dayDate(startDate, offset) {
    if (!startDate) return '';
    return shiftDate(startDate, offset).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The trip's last day (YYYY-MM-DD), or '' without a start date. */
export function tripEndDate(trip) {
    if (!trip.startDate) return '';
    return shiftDate(trip.startDate, trip.plan.length - 1).toISOString().slice(0, 10);
}

export function tripAsText(trip) {
    const lines = [`${trip.title} (${trip.destination})`, ''];
    trip.plan.forEach((day, i) => {
        const date = dayDate(trip.startDate, i);
        lines.push(`Day ${i + 1}${date ? `, ${date}` : ''}`);
        for (const [slot, , label] of SLOTS) {
            if (day[slot]) lines.push(`  ${label}: ${day[slot]}`);
        }
        lines.push('');
    });
    return lines.join('\n').trim();
}

/** A copy to plan another trip from: same days and plans, no dates. */
export function tripTemplate(trip) {
    const suffix = ' (copy)';
    return {
        title: `${trip.title.slice(0, TITLE_MAX_LENGTH - suffix.length)}${suffix}`,
        destination: trip.destination,
        startDate: '',
        plan: trip.plan.map(day => Object.fromEntries(SLOTS.map(([slot]) => [slot, day[slot] || ''])))
    };
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
    if (!trip.startDate) return { error: 'Choose a start date to add this trip to a calendar.' };
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
        const plans = SLOTS.filter(([slot]) => day[slot]).map(([slot, , label]) => `${label}: ${day[slot]}`);
        lines.push(
            'BEGIN:VEVENT',
            `UID:trip-${trip.id ?? 'new'}-${trip.startDate}-day-${i + 1}@travelmapster`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${compactDate(shiftDate(trip.startDate, i))}`,
            `DTEND;VALUE=DATE:${compactDate(shiftDate(trip.startDate, i + 1))}`,
            `SUMMARY:${escapeText(`Day ${i + 1}: ${trip.title}`)}`,
            `LOCATION:${escapeText(trip.destination)}`,
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
