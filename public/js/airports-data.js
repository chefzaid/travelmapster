// The flight log's airports (public/data/airports.json), fetched once and shared by the flight
// log and the year's recap, indexed by IATA code (flight-log.js).
import { airportIndex } from './flight-log.js';

let loading = null;

/** The airports by code, loaded the first time they are needed. */
export function loadAirports() {
    loading ||= fetch(new URL('../data/airports.json', import.meta.url)).then(response => response.json()).then(airportIndex);
    return loading;
}
