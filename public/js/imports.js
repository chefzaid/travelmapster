// Places and visits from other travel apps, to preview before importing: Polarsteps trips
// (trip.json in its data export) and plain lists of countries, as Been or Visited show them.
// Pure, unit tested in Node.

// A Unix time in seconds as the local calendar day it fell on.
function localDay(seconds) {
    const date = new Date(seconds * 1000);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The places of a Polarsteps trip (its trip.json): each step's place, a city with its country,
 * with a visit from the step's day to the day the next step starts (or the trip ends). Steps at
 * the same place add visits to one place.
 */
export function polarstepsPlaces(trip) {
    const steps = (Array.isArray(trip?.all_steps) ? trip.all_steps : [])
        .filter(step => Number.isFinite(Number(step?.start_time)) && Number.isFinite(Number(step?.location?.lat)) && Number.isFinite(Number(step?.location?.lon)))
        .sort((a, b) => Number(a.start_time) - Number(b.start_time));
    const places = new Map();
    steps.forEach((step, i) => {
        const { location } = step;
        const city = String(location.name || step.name || '').trim();
        if (!city) return;
        const country = String(location.detail || '').trim();
        const name = (country ? `${city}, ${country}` : city).slice(0, 200);
        const startDate = localDay(Number(step.start_time));
        const next = steps[i + 1];
        const lastSeconds = next ? Number(next.start_time) : Number(trip.end_date);
        const endDate = Number.isFinite(lastSeconds) && localDay(lastSeconds) > startDate ? localDay(lastSeconds) : startDate;
        if (!places.has(name)) {
            places.set(name, {
                name, category: 'City', type: 'visited', stay: 'visit',
                lat: Math.round(Number(location.lat) * 1000) / 1000,
                lng: Math.round(Number(location.lon) * 1000) / 1000,
                notes: '', photoUrl: '', visits: []
            });
        }
        places.get(name).visits.push({ startDate, endDate, notes: `Polarsteps: ${String(trip.name || '').slice(0, 160)}`.trim(), photoUrl: '', ongoing: false });
    });
    return [...places.values()];
}

/**
 * Countries from a pasted list (one per line, or separated by commas or semicolons), as been-to
 * places at each country's label. Names the map does not know are returned apart.
 */
export function countryListPlaces(text, index) {
    const names = [...new Set(String(text || '').split(/[\n,;،؛]+/).map(name => name.replace(/^[\s•*\-\d.)]+/, '').trim()).filter(Boolean))];
    const places = [];
    const unknown = [];
    const seen = new Set();
    for (const name of names) {
        const country = index.findByName(name);
        if (!country) {
            unknown.push(name);
            continue;
        }
        if (seen.has(country.id)) continue;
        seen.add(country.id);
        places.push({
            name: country.name, category: 'Country', type: 'visited', stay: 'visit',
            lat: country.label[0], lng: country.label[1], notes: '', photoUrl: '', visits: []
        });
    }
    return { places, unknown };
}

/** Polarsteps trip files in a data export: every trip.json inside a trip folder. */
export function polarstepsTripEntries(entries) {
    return entries.filter(entry => /(^|\/)trip\/[^/]+\/trip\.json$/.test(entry.name));
}
