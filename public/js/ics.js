// Trips and flights from a calendar file (iCalendar, .ics), read in the browser: the events that
// look like travel (all-day or several days, or a flight or a train) with where they go. Pure,
// unit tested in Node; the import reviews every visit before saving it (import-apps.js).

const unescape = value => value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// "20260501", "20260501T090000" or "20260501T090000Z": the calendar date, and whether it has a time.
function readDate(value) {
    const match = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(value.trim());
    return match ? { date: `${match[1]}-${match[2]}-${match[3]}`, timed: Boolean(match[4]) } : null;
}

const dayBefore = iso => new Date(Date.parse(iso) - 86_400_000).toISOString().slice(0, 10);

/**
 * The events of a calendar: `{ summary, location, startDate, endDate, allDay, recurring }`, with
 * the end as the last day spent (an all-day event's end date is the day after it).
 */
export function parseCalendar(text) {
    // Long lines continue on the next line after a space or a tab.
    const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const events = [];
    let event = null;
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') event = {};
        else if (line === 'END:VEVENT') {
            if (event?.start) {
                const end = event.end ? (event.end.timed ? event.end.date : dayBefore(event.end.date)) : event.start.date;
                events.push({
                    summary: event.summary || '', location: event.location || '',
                    startDate: event.start.date, endDate: end < event.start.date ? event.start.date : end,
                    allDay: !event.start.timed, recurring: Boolean(event.recurring)
                });
            }
            event = null;
        } else if (event) {
            const colon = line.indexOf(':');
            if (colon < 0) continue;
            const name = line.slice(0, colon).split(';')[0].toUpperCase();
            const value = line.slice(colon + 1);
            if (name === 'SUMMARY') event.summary = unescape(value);
            else if (name === 'LOCATION') event.location = unescape(value);
            else if (name === 'DTSTART') event.start = readDate(value);
            else if (name === 'DTEND') event.end = readDate(value);
            else if (name === 'RRULE') event.recurring = true;
        }
    }
    return events;
}

// A flight or a train in the title, in the app's languages.
const JOURNEY = /\b(flight|fly|vol|vuelo|flug|train|tren|zug)\b|✈|🚆|رحلة|قطار/i;
const TO = /\b(?:to|à|vers|a|nach|إلى)\s+([^()[\]|,–-]+)/i;

/** Whether an event looks like travel: all-day, several days, or a flight or a train. */
export const looksLikeTravel = event => !event.recurring && (event.allDay || event.endDate > event.startDate || JOURNEY.test(event.summary));

/**
 * Where an event goes, most precise first: for a flight or a train the place after "to" in its
 * title (its location is usually where it leaves from), then its location, the end of the
 * location ("…, Lisbon, Portugal"), and its title.
 */
export function eventDestinations(event) {
    const candidates = [];
    if (JOURNEY.test(event.summary)) {
        const to = TO.exec(event.summary)?.[1]?.trim();
        if (to) candidates.push(to);
    }
    const parts = event.location.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length) candidates.push(parts.join(', '));
    if (parts.length > 2) candidates.push(parts.slice(-2).join(', '));
    if (parts.length > 1) candidates.push(parts.at(-2), parts.at(-1));
    if (event.summary) candidates.push(event.summary);
    return [...new Set(candidates)];
}
