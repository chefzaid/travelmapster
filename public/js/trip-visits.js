// Completing a trip: once it has begun, its destination becomes a visit with the trip's dates,
// on the saved place (a wish turns into "been there") or on a new one, after the traveler confirms.
import { toast, formatDate } from './ui.js';
import { normalizeName, searchCities, splitPlaceQuery } from './geo.js';
import { sortVisits, lastVisitDate } from './visits.js';
import { statusFields, statusOf } from './status.js';
import { resolveDestination, tripEndDate } from './itinerary.js';
import { cityMarkerFor, countryMarker } from './cards.js';

// Where a trip goes: a country, or a town of the map data by its exact name.
export function tripPlace(ctx, trip) {
    const { index, cities } = ctx.state;
    return resolveDestination(trip.destination, {
        findCountry: name => index.findByName(name),
        findCity: name => searchCities(cities, name, 1).find(city => normalizeName(city.name) === splitPlaceQuery(name)[0])
    });
}

// The saved place for the destination, if any, and the place to create otherwise.
function destinationPlace(ctx, where) {
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

/** Whether the trip's visit is already recorded on its destination. */
export function tripRecorded(ctx, trip) {
    const where = trip.startDate ? tripPlace(ctx, trip) : null;
    if (!where) return false;
    return Boolean(destinationPlace(ctx, where).existing?.visits?.some(visit => visit.startDate === trip.startDate));
}

export async function completeTrip(ctx, trip) {
    const where = tripPlace(ctx, trip);
    if (!where) {
        toast(`Which place is ${trip.destination}? Name a country or a town, such as “Lisbon, Portugal”.`, { tone: 'error' });
        return false;
    }
    const { existing, place } = destinationPlace(ctx, where);
    const visit = { startDate: trip.startDate, endDate: tripEndDate(trip), notes: `Trip: ${trip.title}`.slice(0, 2000), photoUrl: '', ongoing: false };
    const wish = existing && statusOf(existing) === 'wishlist';
    const confirmed = await ctx.confirmDialog({
        title: 'Record this trip as a visit?',
        message: `${place.name}: a visit from ${formatDate(visit.startDate)} to ${formatDate(visit.endDate)}`
            + `${wish ? ', and it moves from your wishlist to the places you have been' : ''}. You can edit it on the place's card.`,
        confirmLabel: 'Add the visit'
    });
    if (!confirmed) return false;
    try {
        if (!existing) {
            await ctx.savePlace({ ...place, ...statusFields('visited'), visits: [visit] });
            return true;
        }
        if (wish) await ctx.updatePlace(existing, statusFields('visited'));
        const added = await ctx.api.addVisit(existing.id, visit);
        existing.visits = sortVisits([...existing.visits, added]);
        existing.travelDate = lastVisitDate(existing);
        ctx.refresh();
        toast(`Visit added to ${existing.name}. 🎉`, { tone: 'success' });
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}
