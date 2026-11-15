// The countdown to the next trip, on the Explore tab and the passport, and the flags of the
// countries it goes to for its share card.
import { h } from './ui.js';
import { localToday } from './days.js';
import { nextTrip, tripStops, tripTiming } from './itinerary.js';
import { destinationPlace } from './trip-visits.js';
import { t, tn } from './i18n.js';

/** The next trip of the traveler, or under way today, or null. */
export const upcomingTrip = ctx => nextTrip(ctx.state.trips, localToday());

/** "Lisbon in 12 days", "Lisbon starts today" or "Lisbon: under way". */
export function countdownLabel({ trip, days, underWay }) {
    const title = trip.title;
    if (underWay) return t('{title}: under way', { title });
    if (!days) return t('{title} starts today', { title });
    return tn(days, '{title} in {count} day', '{title} in {count} days', { title });
}

/** "In 12 days", "Starts today" or "Under way" on the card of a trip not over yet; null otherwise. */
export function timingBadge(trip, today) {
    const timing = tripTiming(trip, today);
    if (!timing) return null;
    const label = timing.underWay ? t('Under way') : timing.days ? tn(timing.days, 'In {count} day', 'In {count} days') : t('Starts today');
    return h('small', { class: 'timing-badge' }, h('span', { 'aria-hidden': 'true' }, '⏳ '), label);
}

/** The flags of the countries the trip's stops are in, each once, in the order of the stops. */
export function tripFlags(ctx, trip) {
    const ids = new Set(tripStops(trip).map(stop => destinationPlace(ctx, stop.destination)?.countryId).filter(Boolean));
    return [...ids].map(id => ctx.state.index.byId.get(id)?.flag).filter(Boolean);
}

/** The Explore tab's countdown, which opens the Trips tab. */
export function countdownSection(ctx) {
    const next = upcomingTrip(ctx);
    if (!next) return null;
    return h('section', { class: 'countdown', 'aria-labelledby': 'countdown-title' },
        h('p', { class: 'eyebrow', id: 'countdown-title' }, t('Next trip')),
        h('button', { type: 'button', class: 'countdown-btn', onclick: () => ctx.selectTab('trips') },
            h('span', { 'aria-hidden': 'true' }, tripFlags(ctx, next.trip).join('') || '✈️'),
            h('strong', {}, countdownLabel(next))
        )
    );
}
