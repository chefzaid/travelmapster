// The free Schengen 90/180 calculator: stays typed into the public page, checked and counted
// with the day ledger's rules (days.js), without an account. Pure functions, unit tested in
// Node; nothing here touches the DOM, storage or the network.
import { SCHENGEN_RULE, addDays, breaches, countBetween, dayNumber, isoDay, maxStayFrom, usedOn, visitSpan } from './days.js';
import { isValidDate } from './visits.js';

export const MAX_STAYS = 60;

/**
 * Checks the rows of the stay form ({ entry, exit } as YYYY-MM-DD or empty). Blank rows are
 * skipped; an empty exit means "still there", which only makes sense for a stay that has
 * started. Returns the stays in the shape days.js counts, and one error per faulty row.
 */
export function checkStays(rows, today) {
    const stays = [];
    const errors = [];
    rows.slice(0, MAX_STAYS).forEach((row, index) => {
        const entry = String(row?.entry ?? '').trim();
        const exit = String(row?.exit ?? '').trim();
        if (!entry && !exit) return;
        const fail = (field, message) => errors.push({ index, field, message });
        if (!isValidDate(entry)) return fail('entry', 'Choose the day you entered the area.');
        if (exit && !isValidDate(exit)) return fail('exit', 'Choose the day you left, or leave it empty if you are still there.');
        if (exit && exit < entry) return fail('exit', 'The exit day must be on or after the entry day.');
        if (!exit && entry > today) return fail('exit', 'Add the exit day of a planned stay.');
        if (dayNumber(exit || today) - dayNumber(entry) >= 3660) return fail('exit', 'A stay can last at most 3,660 days.');
        stays.push({ index, startDate: entry, endDate: exit, ongoing: !exit });
    });
    return { stays, errors };
}

// Consecutive day numbers grouped into { from, to, days } runs, as dates.
function runs(days) {
    const result = [];
    for (let start = 0, index = 0; index < days.length; index += 1) {
        if (index + 1 < days.length && days[index + 1] === days[index] + 1) continue;
        result.push({ from: isoDay(days[start]), to: isoDay(days[index]), days: index - start + 1 });
        start = index + 1;
    }
    return result;
}

/**
 * Everything the calculator shows for checked stays, counting any part of a day as the
 * Schengen Borders Code does:
 * - `check`: days used in the 180 days up to `checkDate` (today by default) and days left;
 * - `latest`: the longest stay from `checkDate` that breaks no window, from the days before
 *   it, so it answers both "I enter that day" and "I am there and stay on";
 * - `overstays`: every run of days on which the last 180 days held more than 90;
 * - `stays`: each stay with its days, whether it is planned, and the days it goes over.
 */
export function schengenCalculator(stays, { today, checkDate = today }) {
    const rule = SCHENGEN_RULE;
    const spans = stays.map(stay => ({ stay, span: visitSpan(stay, { dayRule: 'presence', today }) }));
    const set = new Set();
    for (const { span } of spans) {
        if (!span) continue;
        for (let day = span.first; day <= span.last; day += 1) set.add(day);
    }
    const days = [...set].sort((a, b) => a - b);
    const over = breaches(days, rule);
    const overSet = new Set(over);

    const check = dayNumber(checkDate);
    const used = usedOn(days, check, rule.windowDays);
    const before = days.filter(day => day < check);
    const latest = maxStayFrom(before, rule, check);

    return {
        maxDays: rule.maxDays,
        windowDays: rule.windowDays,
        check: {
            date: checkDate,
            windowStart: addDays(checkDate, 1 - rule.windowDays),
            used,
            remaining: Math.max(0, rule.maxDays - used),
            inside: countBetween(days, check, check) > 0
        },
        latest: {
            // Already in the area the day before: the stay goes on rather than starts.
            continuing: before.length > 0 && before[before.length - 1] === check - 1,
            days: latest.days,
            lastDate: latest.lastDay === null ? null : isoDay(latest.lastDay)
        },
        overstays: runs(over),
        stays: spans.map(({ stay, span }) => {
            const overDays = [];
            if (span) for (let day = span.first; day <= span.last; day += 1) if (overSet.has(day)) overDays.push(day);
            return {
                ...stay,
                days: span ? span.last - span.first + 1 : 0,
                planned: stay.startDate > today,
                overDays: overDays.length,
                firstOver: overDays.length ? isoDay(overDays[0]) : null
            };
        })
    };
}
