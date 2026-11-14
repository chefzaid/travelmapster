// Firsts: when each continent was first set foot on, and the country it was, from the visit
// dates of places been to (visited, lived in or passed through). Pure, unit tested in Node.
import { statusOf } from './status.js';

/**
 * The first visit to each continent, the earliest first, as `{ continent, date, country }`
 * (`country` the map's country). `countryOf(marker)` is the place's country, with its
 * `continent`; places without a dated visit or a country are left out.
 */
export function continentFirsts(markers, countryOf) {
    const firsts = new Map();
    for (const marker of markers) {
        if (statusOf(marker) === 'wishlist') continue;
        const country = countryOf(marker);
        if (!country?.continent) continue;
        const dates = (marker.visits || []).map(visit => visit.startDate).filter(Boolean);
        if (!dates.length) continue;
        const date = dates.reduce((earliest, day) => (day < earliest ? day : earliest));
        const known = firsts.get(country.continent);
        if (!known || date < known.date || (date === known.date && country.name < known.country.name)) {
            firsts.set(country.continent, { continent: country.continent, date, country });
        }
    }
    return [...firsts.values()].sort((a, b) => a.date.localeCompare(b.date) || a.continent.localeCompare(b.continent));
}
