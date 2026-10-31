// Family view of a trip (/family/<token>): where the traveler is on a given day, from the
// trip's stops and dates the private link shows. Pure, unit tested in Node.
import { dayNumber } from './days.js';

/**
 * Where the traveler is on `today` (YYYY-MM-DD): `undated` for a trip without a start date,
 * `before` with the `days` until it starts, `during` with the `day` of the trip (from 1) and
 * its `stop`, or `after` once it has ended.
 */
export function whereNow(view, today) {
    if (!view.startDate) return { state: 'undated' };
    const day = dayNumber(today) - dayNumber(view.startDate);
    if (day < 0) return { state: 'before', days: -day };
    if (day >= view.days) return { state: 'after' };
    const stop = view.stops.find(item => day >= item.firstDay && day < item.firstDay + item.days);
    return { state: 'during', day: day + 1, stop };
}
