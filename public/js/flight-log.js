// Flight log: flights by date and IATA airport codes (airports from OurAirports, public domain),
// the distance flown per year with a rough CO₂ estimate, and arcs to replay on the map. The
// rules match src/flights.js. Pure, unit tested in Node.
import { distanceKm } from './travel-stats.js';
import { journeyArc } from './journeys.js';
import { isValidDate } from './visits.js';
import { t } from './i18n.js';

// A rough average for an economy seat, without the extra warming of contrails: about 90 g of
// CO₂ per passenger-kilometre. Real flights vary a lot with the plane, the load and the route.
export const CO2_KG_PER_KM = 0.09;
export const FLIGHTS_MAX = 2000;
const CODE_PATTERN = /^[A-Z]{3}$/;
const NUMBER_PATTERN = /^[A-Z0-9]{2,3} ?\d{1,4}[A-Z]?$/;

/** The airports by IATA code, from the rows of public/data/airports.json. */
export function airportIndex(rows) {
    return new Map(rows.map(([code, name, town, lat, lng]) => [code, { code, name, town, lat, lng }]));
}

/** "Lisbon (LIS)", or the airport's name where it has no town, or the bare code if unknown. */
export function airportLabel(airports, code) {
    const airport = airports.get(code);
    return airport ? `${airport.town || airport.name} (${code})` : code;
}

/** A flight from the form, or what is wrong with it, as the API checks it. */
export function checkFlight(values) {
    const text = value => String(value ?? '').trim().toUpperCase();
    const flight = { date: String(values.date ?? '').trim(), from: text(values.from), to: text(values.to), number: text(values.number) || null };
    if (!isValidDate(flight.date)) return { error: t('Choose the day of the flight.') };
    if (!CODE_PATTERN.test(flight.from) || !CODE_PATTERN.test(flight.to)) return { error: t('A flight goes between two three-letter airport codes, such as LIS and KIX.') };
    if (flight.from === flight.to) return { error: t('A flight lands at another airport than the one it left.') };
    if (flight.number && !NUMBER_PATTERN.test(flight.number)) return { error: t('A flight number looks like TP 1352.') };
    return { flight };
}

/** Flights the latest first, as the API lists them. */
export const latestFirst = flights => [...flights].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

/** The great-circle distance of a flight in kilometres, or null when an airport is unknown. */
export function flightKm(flight, airports) {
    const from = airports.get(flight.from);
    const to = airports.get(flight.to);
    return from && to ? distanceKm(from, to) : null;
}

/**
 * Flights, distance and the rough CO₂ per year, the latest year first, and in all; `unknown`
 * lists the airport codes the data does not know, whose flights count without a distance.
 */
export function flightStats(flights, airports) {
    const years = new Map();
    const unknown = new Set();
    const total = { flights: 0, km: 0, co2Kg: 0 };
    for (const flight of flights) {
        const year = flight.date.slice(0, 4);
        const entry = years.get(year) || { year, flights: 0, km: 0, co2Kg: 0 };
        const km = flightKm(flight, airports);
        for (const code of [flight.from, flight.to]) if (!airports.has(code)) unknown.add(code);
        for (const sum of [entry, total]) {
            sum.flights += 1;
            sum.km += km || 0;
            sum.co2Kg += (km || 0) * CO2_KG_PER_KM;
        }
        years.set(year, entry);
    }
    return { years: [...years.values()].sort((a, b) => b.year.localeCompare(a.year)), total, unknown: [...unknown].sort() };
}

/** The flights as arcs of [lng, lat] points, oldest first, for the map's replay. */
export function flightArcs(flights, airports) {
    return [...flights].sort((a, b) => a.date.localeCompare(b.date))
        .filter(flight => airports.has(flight.from) && airports.has(flight.to))
        .map(flight => journeyArc(airports.get(flight.from), airports.get(flight.to)));
}
