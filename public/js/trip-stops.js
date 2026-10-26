// Editing a trip's stops in its draft: adding and removing stops, changing how many days each
// lasts, and adding or removing days, keeping the plan's days and the stops' days in step. The
// trip's destination stays its first stop's. Pure, unit tested in Node.
import { emptyDay, tripStops } from './itinerary.js';

export const MAX_DAYS = 30;
export const MAX_STOPS = 10;

// The stops as stored, from what the plan holds now; one stop left is a trip without stops.
function setStops(draft, stops) {
    draft.stops = stops.length > 1 ? stops.map(({ destination, days }) => ({ destination, days })) : [];
    if (stops.length) draft.destination = stops[0].destination || draft.destination;
}

/** Adds an empty stop of one day at the end; false when the trip is full. */
export function addStop(draft) {
    const stops = tripStops(draft);
    if (draft.plan.length >= MAX_DAYS || stops.length >= MAX_STOPS) return false;
    draft.plan.push(emptyDay());
    draft.stops = [...stops.map(({ destination, days }) => ({ destination, days })), { destination: '', days: 1 }];
    return true;
}

/** Removes a stop and its days; the trip keeps at least one day. */
export function removeStop(draft, index) {
    const stops = tripStops(draft);
    if (stops.length < 2 || !stops[index]) return;
    draft.plan.splice(stops[index].firstDay, stops[index].days);
    setStops(draft, stops.filter((_, i) => i !== index));
}

/** Names a stop's destination. */
export function renameStop(draft, index, destination) {
    const stops = tripStops(draft);
    if (!stops[index]) return;
    stops[index].destination = destination;
    if (draft.stops?.length) setStops(draft, stops);
    else draft.destination = destination;
}

/** A stop lasts `days` days: days are added or removed at its end, within the trip's limit. */
export function resizeStop(draft, index, days) {
    const stops = tripStops(draft);
    const stop = stops[index];
    if (!stop) return;
    const wanted = Math.max(1, Math.min(Math.trunc(days) || 1, stop.days + MAX_DAYS - draft.plan.length));
    const end = stop.firstDay + stop.days;
    if (wanted > stop.days) draft.plan.splice(end, 0, ...Array.from({ length: wanted - stop.days }, emptyDay));
    else draft.plan.splice(stop.firstDay + wanted, stop.days - wanted);
    stop.days = wanted;
    setStops(draft, stops);
}

/** Adds a day at the end of the trip, to its last stop. */
export function addTripDay(draft) {
    if (draft.plan.length >= MAX_DAYS) return;
    const stops = tripStops(draft);
    draft.plan.push(emptyDay());
    stops.at(-1).days += 1;
    if (draft.stops?.length) setStops(draft, stops);
}

/** Removes a day; a stop left without days goes. */
export function removeTripDay(draft, day) {
    if (draft.plan.length < 2) return;
    const stops = tripStops(draft);
    const stop = stops.find(item => day >= item.firstDay && day < item.firstDay + item.days);
    draft.plan.splice(day, 1);
    stop.days -= 1;
    if (draft.stops?.length) setStops(draft, stops.filter(item => item.days > 0));
}
