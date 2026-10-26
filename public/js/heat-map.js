// Days on the map: countries colored by the days the ledger counts in them instead of by
// status, in four steps that match the common rules (a month, Schengen's 90 days, the 183-day
// tax rule). Pure, unit tested in Node.
import { dayNumber } from './days.js';
import { formatNumber, t } from './i18n.js';

// The fewest days of each step; the map's --heat-1 … --heat-4 tokens color them.
export const HEAT_STEPS = Object.freeze([1, 30, 90, 183]);

/** A country's step for a number of days: 0 for none, 1 to 4. */
export function heatLevel(days) {
    let level = 0;
    for (const [index, min] of HEAT_STEPS.entries()) if (days >= min) level = index + 1;
    return level;
}

/**
 * Days per country recorded between two dates (YYYY-MM-DD, both included; from all time
 * when `from` is omitted). Planned stays do not count: the map shows where the traveler has been.
 * @param {{ countries: Map<string, Map<number, { kind: string }[]>> }} ledger
 * @param {{ from?: string, to: string }} period
 * @returns {Map<string, number>}
 */
export function recordedDays(ledger, { from, to }) {
    const start = from ? dayNumber(from) : -Infinity;
    const end = dayNumber(to);
    const result = new Map();
    for (const [countryId, days] of ledger.countries) {
        let count = 0;
        for (const [day, sources] of days) {
            if (day >= start && day <= end && sources.some(source => source.kind !== 'planned')) count += 1;
        }
        if (count) result.set(countryId, count);
    }
    return result;
}

/** The legend's steps: their label and how many countries are in each, fewest days first. */
export function heatLegend(daysByCountry) {
    const counts = HEAT_STEPS.map(() => 0);
    for (const days of daysByCountry.values()) {
        const level = heatLevel(days);
        if (level) counts[level - 1] += 1;
    }
    return HEAT_STEPS.map((min, index) => {
        const next = HEAT_STEPS[index + 1];
        return {
            level: index + 1,
            label: next ? t('{from}–{to} days', { from: formatNumber(min), to: formatNumber(next - 1) }) : t('{from}+ days', { from: formatNumber(min) }),
            countries: counts[index]
        };
    });
}
