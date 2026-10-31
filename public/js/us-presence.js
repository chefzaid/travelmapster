// The US Substantial Presence Test, which no stay rule or threshold can express: days in the
// United States this year, plus a third of last year's and a sixth of the year before's, reach
// 183, with at least 31 this year. Any part of a day counts, as the IRS counts it; days the IRS
// leaves out (such as an exempt student's or a transit of under a day) are not known here.
// Pure, unit tested in Node.
import { countBetween, dayNumber, daysIn } from './days.js';

export const US = 'USA';
const NEEDED = 183;
const THIS_YEAR_MIN = 31;
const WARN_DAYS = 30;

/**
 * The test for the calendar year of `today`, counted up to today: the days of each of the three
 * years, the weighted total (fractions kept), and `status`: `reached`, `warning` within 30 days
 * of 183, or `ok`. Null when no day in the United States falls in those three years.
 */
export function substantialPresence(ledger, today) {
    const year = Number(today.slice(0, 4));
    const days = daysIn(ledger, [US]);
    const end = dayNumber(today);
    const inYear = y => countBetween(days, dayNumber(`${y}-01-01`), Math.min(dayNumber(`${y}-12-31`), end));
    const counts = { current: inYear(year), last: inYear(year - 1), before: inYear(year - 2) };
    if (!counts.current && !counts.last && !counts.before) return null;
    const total = counts.current + counts.last / 3 + counts.before / 6;
    const met = counts.current >= THIS_YEAR_MIN && total >= NEEDED;
    return {
        year, ...counts, total, needed: NEEDED,
        status: met ? 'reached' : total >= NEEDED - WARN_DAYS ? 'warning' : 'ok'
    };
}
