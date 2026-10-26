// Visits found in a phone's location history or in photos' metadata, kept in the browser and
// reduced to towns (or countries) with visit dates before the traveler reviews them. Pure, unit
// tested in Node.
import { addDays } from './days.js';

// Days without a sighting that still belong to the same stay.
const GAP_DAYS = 2;
// A stay longer than this in one place is cut there: location history can hold months at home.
const MAX_SPAN_DAYS = 366;
export const VISITS_PER_PLACE = 500;

/**
 * The calendar day of a timestamp where it happened: the date as written for a day or a time
 * with its offset, else UTC (or milliseconds) shifted by the longitude's time zone (15° an hour).
 */
export function localDayOf(timestamp, lng = 0) {
    const text = String(timestamp ?? '');
    // A day as is (a photo's), or a time with its offset.
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{4}-\d{2}-\d{2}T[^Z]*[+-]\d{2}:?\d{2}$/.test(text)) return text.slice(0, 10);
    const ms = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms + Math.round(lng / 15) * 3_600_000).toISOString().slice(0, 10);
}

// "48.8566°, 2.3522°", "geo:48.8566,2.3522" or E7 integers.
function latLng(value) {
    if (value && typeof value === 'object') {
        if (Number.isFinite(value.latitudeE7) && Number.isFinite(value.longitudeE7)) return [value.latitudeE7 / 1e7, value.longitudeE7 / 1e7];
        return latLng(value.latLng ?? value.placeLocation);
    }
    const match = /(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)/.exec(String(value ?? ''));
    return match ? [Number(match[1]), Number(match[2])] : null;
}

function sighting(position, start, end) {
    if (!position) return null;
    const [lat, lng] = position;
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
    const startDate = localDayOf(start, lng);
    const endDate = localDayOf(end ?? start, lng) || startDate;
    if (!startDate) return null;
    return { lat, lng, startDate, endDate: endDate < startDate ? startDate : endDate };
}

/**
 * The places stayed at in a location history file: Google Takeout's Semantic Location History
 * (`timelineObjects`), or the Timeline export from Android (`semanticSegments`) or iOS (a list).
 * Movements between places are left out. Returns `{ lat, lng, startDate, endDate }` stays.
 */
export function timelineSightings(json) {
    if (Array.isArray(json?.timelineObjects)) {
        return json.timelineObjects.map(item => item?.placeVisit).filter(Boolean).map(visit => sighting(
            latLng(visit.location),
            visit.duration?.startTimestamp ?? visit.duration?.startTimestampMs,
            visit.duration?.endTimestamp ?? visit.duration?.endTimestampMs
        )).filter(Boolean);
    }
    const segments = Array.isArray(json?.semanticSegments) ? json.semanticSegments : Array.isArray(json) ? json : [];
    return segments.filter(segment => segment?.visit)
        .map(segment => sighting(latLng(segment.visit.topCandidate?.placeLocation), segment.startTime, segment.endTime))
        .filter(Boolean);
}

/** Days into stays: runs of days with gaps of up to two days, as `{ startDate, endDate }`. */
export function daysToStays(days) {
    const sorted = [...new Set(days)].sort();
    const stays = [];
    for (const day of sorted) {
        const last = stays.at(-1);
        if (last && day <= addDays(last.endDate, GAP_DAYS + 1)) last.endDate = day;
        else stays.push({ startDate: day, endDate: day });
    }
    return stays;
}

function spanDays(startDate, endDate) {
    const days = [];
    for (let day = startDate; day <= endDate && days.length < MAX_SPAN_DAYS; day = addDays(day, 1)) days.push(day);
    return days;
}

/**
 * Places to import from sightings: each sighting goes to its town (`townNear(lat, lng)`, which
 * may resolve to null) or else to its country (`countryAt(lat, lng)`); places get their stays
 * as visits, the latest first kept when there are too many. Positions are never kept: a town
 * is placed at the town, a country at its label.
 */
export async function placesFromSightings(sightings, { townNear, countryAt, countryById, source }) {
    const places = new Map();
    const cache = new Map();
    for (const { lat, lng, startDate, endDate } of sightings) {
        // Nearby points share a lookup.
        const key = `${lat.toFixed(2)}|${lng.toFixed(2)}`;
        if (!cache.has(key)) {
            const town = await townNear(lat, lng);
            const country = town ? countryById(town.countryId) : countryAt(lat, lng);
            cache.set(key, town && country
                ? { name: `${town.name}, ${country.name}`, category: 'City', lat: town.lat, lng: town.lng }
                : country ? { name: country.name, category: 'Country', lat: country.label[0], lng: country.label[1] } : null);
        }
        const target = cache.get(key);
        if (!target) continue;
        if (!places.has(target.name)) places.set(target.name, { ...target, days: [] });
        places.get(target.name).days.push(...spanDays(startDate, endDate));
    }
    return [...places.values()].map(({ days, ...place }) => ({
        ...place,
        type: 'visited',
        stay: 'visit',
        notes: '',
        photoUrl: '',
        visits: daysToStays(days).slice(-VISITS_PER_PLACE).map(stay => ({ ...stay, notes: source, photoUrl: '', ongoing: false }))
    })).sort((a, b) => a.visits[0].startDate.localeCompare(b.visits[0].startDate));
}
