// Flights pasted into the flight log: lines such as "2026-05-01 LIS KIX TP1352", or a CSV with
// date, from and to columns as airline and flight tracking apps export them. Each flight is
// checked as the API checks it (flight-log.js); lines not understood are kept to show.
// Pure, unit tested in Node.
import { checkFlight } from './flight-log.js';
import { csvRows } from './io.js';

export const PASTE_MAX = 500;

// Header names apps use for each column, compared without case, spaces or punctuation.
const COLUMNS = {
    date: ['date', 'flightdate', 'departuredate', 'day'],
    from: ['from', 'origin', 'departure', 'departureairport', 'fromairport', 'dep'],
    to: ['to', 'destination', 'arrival', 'arrivalairport', 'toairport', 'arr', 'dest'],
    number: ['flight', 'flightnumber', 'number', 'flightno']
};
const plain = value => String(value).toLowerCase().replace(/[^a-z]/g, '');

// A CSV's records as flight fields, when its header names a date, a from and a to column.
function csvFlights(text) {
    let rows;
    try {
        rows = csvRows(text);
    } catch {
        return null;
    }
    if (rows.length < 2) return null;
    const headers = rows[0].map(header => header.trim().replace(/^\uFEFF/, ''));
    const records = rows.slice(1).filter(values => values.some(value => value.trim())).map(values => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])));
    const column = key => headers.find(header => COLUMNS[key].includes(plain(header)));
    const [date, from, to, number] = ['date', 'from', 'to', 'number'].map(column);
    if (!date || !from || !to) return null;
    // Airport cells such as "Lisbon (LIS)" give their code.
    const code = value => (/\b([A-Za-z]{3})\b\)?\s*$/.exec(String(value ?? '').trim()) || [])[1] || String(value ?? '').trim();
    return records.map(record => ({
        line: headers.map(header => record[header]).join(', '),
        values: { date: String(record[date] ?? '').trim().slice(0, 10), from: code(record[from]), to: code(record[to]), number: number ? record[number] : '' }
    }));
}

// A line of free text: its date, the first two airport codes after it, and a flight number.
function lineFlight(line) {
    const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(line)?.[1] || '';
    const rest = line.replace(date, ' ');
    // Codes written in capitals win over three-letter words such as "via".
    const upper = rest.match(/\b[A-Z]{3}\b/g) || [];
    const codes = upper.length >= 2 ? upper : rest.match(/\b[A-Za-z]{3}\b/g) || [];
    const number = (rest.match(/\b[A-Za-z0-9]{2,3} ?\d{1,4}[A-Za-z]?\b/g) || []).find(token => /\d/.test(token)) || '';
    return { line, values: { date, from: codes[0] || '', to: codes[1] || '', number } };
}

/**
 * The flights in pasted text, at most 500: `flights` checked and ready to add, `skipped` the
 * lines not understood, and `known` how many were already in the log (same day and airports).
 */
export function readPastedFlights(text, existing = []) {
    const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rows = csvFlights(lines.join('\n')) || lines.map(lineFlight);
    const seen = new Set(existing.map(flight => `${flight.date} ${flight.from} ${flight.to}`));
    const flights = [];
    const skipped = [];
    let known = 0;
    for (const { line, values } of rows) {
        const { flight } = checkFlight(values);
        if (!flight) {
            skipped.push(line);
            continue;
        }
        const key = `${flight.date} ${flight.from} ${flight.to}`;
        if (seen.has(key)) {
            known += 1;
            continue;
        }
        seen.add(key);
        flights.push(flight);
    }
    return { flights: flights.slice(0, PASTE_MAX), skipped, known, tooMany: Math.max(0, flights.length - PASTE_MAX) };
}
