// "On this day": visits that began on today's calendar day in an earlier year, and "long time no
// see": countries last visited years ago, shown on the Explore tab. Pure, unit tested in Node.
import { statusOf } from './status.js';
import { tn } from './i18n.js';

const isLeapYear = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Visits and stays lived in (not layovers or wishes) that started on today's month and day in
 * an earlier year, the most recent first. A visit that began on 29 February comes back on 28
 * February in other years.
 */
export function onThisDay(markers, today) {
    const year = Number(today.slice(0, 4));
    const monthDay = today.slice(5);
    const days = new Set([monthDay]);
    if (monthDay === '02-28' && !isLeapYear(year)) days.add('02-29');
    const memories = [];
    for (const marker of markers) {
        if (!['visited', 'lived'].includes(statusOf(marker))) continue;
        for (const visit of marker.visits || []) {
            const visitYear = Number(visit.startDate.slice(0, 4));
            if (visitYear < year && days.has(visit.startDate.slice(5))) {
                memories.push({ marker, visit, yearsAgo: year - visitYear });
            }
        }
    }
    return memories.sort((a, b) => a.yearsAgo - b.yearsAgo || a.marker.name.localeCompare(b.marker.name));
}

export function memoryLabel({ marker, yearsAgo }) {
    const place = marker.name.split(',')[0];
    return statusOf(marker) === 'lived'
        ? tn(yearsAgo, 'A year ago today, you moved to {place}', '{count} years ago today, you moved to {place}', { place })
        : tn(yearsAgo, 'A year ago today, you arrived in {place}', '{count} years ago today, you arrived in {place}', { place });
}

// Countries not seen for this many years come back as "long time no see".
export const LONG_AGO_YEARS = 5;

/**
 * Countries been to (visits and stays lived in, not layovers) whose last visit ended at least
 * `years` years before today, the longest ago first, with the towns visited there. The home
 * country is left out, and a visit still going on or planned ahead keeps a country off the list.
 */
export function longTimeNoSee(markers, { today, countryOf, homeId = null, years = LONG_AGO_YEARS }) {
    const cutoff = `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
    const byCountry = new Map();
    for (const marker of markers) {
        if (!['visited', 'lived'].includes(statusOf(marker)) || !marker.visits?.length) continue;
        const country = countryOf(marker);
        if (!country || country.id === homeId) continue;
        const entry = byCountry.get(country.id) || { country, last: '', places: new Set() };
        byCountry.set(country.id, entry);
        for (const visit of marker.visits) {
            const last = visit.ongoing && !visit.endDate ? today : visit.endDate || visit.startDate;
            if (last > entry.last) entry.last = last;
        }
        if (marker.category === 'City') entry.places.add(marker.name.split(',')[0]);
    }
    return [...byCountry.values()]
        .filter(entry => entry.last <= cutoff)
        .map(({ country, last, places }) => ({ country, last, places: [...places].sort() }))
        .sort((a, b) => a.last.localeCompare(b.last) || a.country.name.localeCompare(b.country.name));
}
