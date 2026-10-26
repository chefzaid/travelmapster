// Editing a trip's days and stops in its draft: adding and removing stops, changing how many
// days each lasts, adding, removing and reordering days, and moving plans between slots, keeping
// the plan's days and the stops' days in step. The trip's destination stays its first stop's.
// Pure, unit tested in Node.
import { SLOTS, emptyDay, tripStops } from './itinerary.js';

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

/**
 * Moves a day's plans to another position; the days after it shift. Stops keep their days, so a
 * day's plans can move to another stop.
 */
export function moveDay(draft, from, to) {
    const { length } = draft.plan;
    if (from === to || from < 0 || to < 0 || from >= length || to >= length) return false;
    const [day] = draft.plan.splice(from, 1);
    draft.plan.splice(to, 0, day);
    return true;
}

/** Swaps the plans of two slots, such as a day's morning and another day's evening. */
export function swapSlots(draft, from, to) {
    const slots = new Set(SLOTS.map(([slot]) => slot));
    const a = draft.plan[from.day];
    const b = draft.plan[to.day];
    if (!a || !b || !slots.has(from.slot) || !slots.has(to.slot) || (from.day === to.day && from.slot === to.slot)) return false;
    [a[from.slot], b[to.slot]] = [b[to.slot], a[from.slot]];
    return true;
}
