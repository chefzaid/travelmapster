// Completing a trip: once it has begun, each of its stops becomes a visit with the stop's dates,
// on the saved place (a wish turns into "been there") or on a new one, after the traveler confirms.
import { toast, formatDate } from './ui.js';
import { normalizeName, searchCities, splitPlaceQuery } from './geo.js';
import { sortVisits, lastVisitDate } from './visits.js';
import { statusFields, statusOf } from './status.js';
import { resolveDestination, tripEndDate, tripStops } from './itinerary.js';
import { cityMarkerFor, countryMarker } from './cards.js';

// Where a destination is: a country, or a town of the map data by its exact name.
export function destinationPlace(ctx, destination) {
    const { index, cities } = ctx.state;
    return resolveDestination(destination, {
        findCountry: name => index.findByName(name),
        findCity: name => searchCities(cities, name, 1).find(city => normalizeName(city.name) === splitPlaceQuery(name)[0])
    });
}

// The saved place for the destination, if any, and the place to create otherwise.
function savedOrNew(ctx, where) {
    if (where.city) {
        const { city } = where;
        return {
            existing: cityMarkerFor(ctx, city),
            place: { lat: city.lat, lng: city.lng, name: `${city.name}, ${city.country}`, category: 'City' }
        };
    }
    const { country } = where;
    return {
        existing: countryMarker(ctx, country),
        place: { lat: country.label[0], lng: country.label[1], name: country.name, category: 'Country' }
    };
}

/**
 * The visits a trip makes: one per stop, from its first day to the day the next stop starts
 * (a travel day is spent in both) or the trip ends; `{ unknown }` names a destination that is
 * no known place.
 */
function tripVisits(ctx, trip) {
    const stops = tripStops(trip);
    const visits = [];
    // A business trip makes business visits for its organization (ADR 0030).
    const business = (ctx.state.orgs || []).some(org => org.id === trip.organizationId)
        ? { purpose: 'business', organizationId: trip.organizationId } : {};
    for (const [i, stop] of stops.entries()) {
        const where = destinationPlace(ctx, stop.destination);
        if (!where) return { unknown: stop.destination };
        const endDate = stops[i + 1]?.startDate || tripEndDate(trip);
        visits.push({ where, ...savedOrNew(ctx, where), visit: { startDate: stop.startDate, endDate, notes: `Trip: ${trip.title}`.slice(0, 2000), photoUrl: '', ongoing: false, ...business } });
    }
    return { visits };
}

/** Whether every stop's visit is already recorded on its place. */
export function tripRecorded(ctx, trip) {
    const { visits } = trip.startDate ? tripVisits(ctx, trip) : {};
    return Boolean(visits?.length) && visits.every(({ existing, visit }) =>
        existing?.visits?.some(item => item.startDate === visit.startDate));
}

// Looked up again for each visit: a trip back to a place saved by an earlier stop adds to it.
// A new place takes a personal visit with it; a business one is added once it exists.
async function addTripVisit(ctx, { where, visit }) {
    const { existing: saved, place } = savedOrNew(ctx, where);
    if (!saved && visit.purpose !== 'business') {
        await ctx.savePlace({ ...place, ...statusFields('visited'), visits: [visit] }, { quiet: true });
        return;
    }
    const existing = saved || await ctx.savePlace({ ...place, ...statusFields('visited') }, { quiet: true });
    if (statusOf(existing) === 'wishlist') await ctx.updatePlace(existing, statusFields('visited'));
    if (existing.visits?.some(item => item.startDate === visit.startDate)) return;
    const added = await ctx.api.addVisit(existing.id, visit);
    existing.visits = sortVisits([...existing.visits, added]);
    existing.travelDate = lastVisitDate(existing);
}

export async function completeTrip(ctx, trip) {
    const { visits, unknown } = tripVisits(ctx, trip);
    if (unknown !== undefined) {
        toast(`Which place is ${unknown}? Name a country or a town, such as “Lisbon, Portugal”.`, { tone: 'error' });
        return false;
    }
    const wishes = visits.some(({ existing }) => existing && statusOf(existing) === 'wishlist');
    const confirmed = await ctx.confirmDialog({
        title: visits.length > 1 ? 'Record this trip as visits?' : 'Record this trip as a visit?',
        message: `${visits.map(({ place, visit }) => `${place.name}: a visit from ${formatDate(visit.startDate)} to ${formatDate(visit.endDate)}`).join('; ')}`
            + `${wishes ? ', and wishes move from your wishlist to the places you have been' : ''}. You can edit visits on the place's card.`,
        confirmLabel: visits.length > 1 ? 'Add the visits' : 'Add the visit'
    });
    if (!confirmed) return false;
    try {
        for (const item of visits) await addTripVisit(ctx, item);
        ctx.refresh();
        toast(visits.length > 1 ? `${visits.length} visits added. 🎉` : `Visit added to ${visits[0].place.name}. 🎉`, { tone: 'success' });
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}
