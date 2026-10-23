// Day ledger: counts the days spent in each country from the dated visits of places, checks
// stay rules such as Schengen 90/180 and tax-residency thresholds, simulates planned stays
// and builds day-by-day evidence. Pure functions over plain calendar dates (YYYY-MM-DD,
// local at the destination), unit tested in Node. The rules are explained in ADR 0010.
import { isValidDate } from './visits.js';

export const DAY_MS = 86_400_000;

/** Days since 1970-01-01 of a YYYY-MM-DD date; calendar dates never shift with time zones. */
export function dayNumber(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function isoDay(number) {
    return new Date(number * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
    return isoDay(dayNumber(iso) + days);
}

/** Today's date on this device, which is where the traveler is. */
export function localToday(now = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const DAY_RULES = {
    presence: {
        label: 'Any part of a day',
        description: 'A day counts in every country you were in at any time that day, including the days you arrive and leave. Schengen and most visa rules count this way.'
    },
    midnight: {
        label: 'Midnight rule',
        description: 'A day counts where you are at midnight, so the day you leave does not count and a day trip counts none. Some tax rules, such as the UK\'s, count this way.'
    }
};

// Full Schengen members as of 2026: Bulgaria and Romania since 1 January 2025. Cyprus
// (not yet applying the rules) and Ireland (opted out) are EU members outside the area.
export const SCHENGEN_MEMBERS = Object.freeze([
    'AUT', 'BEL', 'BGR', 'CHE', 'CZE', 'DEU', 'DNK', 'ESP', 'EST', 'FIN', 'FRA', 'GRC', 'HRV', 'HUN',
    'ISL', 'ITA', 'LIE', 'LTU', 'LUX', 'LVA', 'MLT', 'NLD', 'NOR', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'SWE'
]);
// Monaco, San Marino and the Vatican have open borders with France or Italy and are entered
// only through the area, so their days count. Andorra keeps border checks and does not.
export const SCHENGEN_OPEN_BORDERS = Object.freeze(['MCO', 'SMR', 'VAT']);
export const SCHENGEN_AREA = Object.freeze([...SCHENGEN_MEMBERS, ...SCHENGEN_OPEN_BORDERS]);

export const SCHENGEN_RULE = Object.freeze({
    id: 'schengen', kind: 'stay', name: 'Schengen 90/180', countries: SCHENGEN_AREA,
    maxDays: 90, windowDays: 180, warnDays: 10, dayRule: 'presence', builtIn: true
});

// Applied to each country on its own, under the traveler's day rule.
export const TAX_RESIDENCY_RULE = Object.freeze({
    id: 'tax-183', kind: 'threshold', name: '183 days in a calendar year', countries: null,
    maxDays: 183, period: 'year', yearStart: '01-01', warnDays: 30, builtIn: true
});

// The ledger covers 1900 to ten years ahead, which also bounds the work of a mistyped date.
const FIRST_DAY = dayNumber('1900-01-01');
const FUTURE_DAYS = 3660;

/**
 * The days a visit counts, as day numbers { first, last, open }, or null for none.
 * - With an end date: every day from the first to the last under "any part of a day";
 *   the midnight rule drops the last day (the night is spent elsewhere).
 * - Still going on (`ongoing`): through today, or the first day if it starts later.
 * - End not recorded: the first day only, flagged so the traveler can fix it.
 */
export function visitSpan(visit, { dayRule = 'presence', today }) {
    const first = dayNumber(visit.startDate);
    const now = dayNumber(today);
    let last = first;
    let open = null;
    if (visit.endDate) {
        last = dayNumber(visit.endDate) - (dayRule === 'midnight' ? 1 : 0);
    } else if (visit.ongoing) {
        open = 'ongoing';
        last = Math.max(first, now);
    } else {
        open = 'unrecorded';
    }
    const from = Math.max(first, FIRST_DAY);
    const to = Math.min(last, now + FUTURE_DAYS);
    return to < from ? null : { first: from, last: to, open };
}

/**
 * Expands visits into days per country. A city's visits count for its country, and a day
 * counts once per country however many places it holds. `countryOf(marker)` returns the
 * country ({ id }) a place lies in; planned stays ({ id, countryId, startDate, endDate })
 * are added as sources of kind "planned".
 */
export function buildLedger(markers, countryOf, { dayRule = 'presence', today, planned = [] }) {
    const countries = new Map();
    const ongoing = new Set();
    const unplaced = [];
    const add = (countryId, span, source) => {
        let days = countries.get(countryId);
        if (!days) {
            days = new Map();
            countries.set(countryId, days);
        }
        for (let day = span.first; day <= span.last; day += 1) {
            const sources = days.get(day);
            if (sources) sources.push(source);
            else days.set(day, [source]);
        }
    };

    for (const marker of markers) {
        if (!marker.visits?.length) continue;
        const country = countryOf(marker);
        if (!country) {
            unplaced.push(marker);
            continue;
        }
        for (const visit of marker.visits) {
            const span = visitSpan(visit, { dayRule, today });
            if (!span) continue;
            if (span.open === 'ongoing' && span.last === dayNumber(today)) ongoing.add(country.id);
            add(country.id, span, {
                kind: 'visit',
                countryId: country.id,
                markerId: marker.id,
                visitId: visit.id,
                place: marker.name,
                category: marker.category,
                startDate: visit.startDate,
                endDate: visit.endDate || '',
                ongoing: Boolean(visit.ongoing) && !visit.endDate,
                open: span.open
            });
        }
    }
    for (const stay of planned) {
        const span = visitSpan(stay, { dayRule, today });
        if (!span) continue;
        add(stay.countryId, span, {
            kind: 'planned', countryId: stay.countryId, plannedId: stay.id, place: 'Planned stay',
            startDate: stay.startDate, endDate: stay.endDate, ongoing: false, open: null
        });
    }
    return { dayRule, today, countries, ongoing, unplaced, sorted: new Map() };
}

/** Sorted unique day numbers spent in any of the countries (all countries when omitted). */
export function daysIn(ledger, countryIds) {
    const ids = countryIds ? [...countryIds] : [...ledger.countries.keys()];
    const key = ids.length === 1 ? ids[0] : null;
    if (key && ledger.sorted.has(key)) return ledger.sorted.get(key);
    const set = new Set();
    for (const id of ids) {
        for (const day of ledger.countries.get(id)?.keys() ?? []) set.add(day);
    }
    const days = [...set].sort((a, b) => a - b);
    if (key) ledger.sorted.set(key, days);
    return days;
}

// Index of the first day >= value in a sorted array.
function lowerBound(days, value) {
    let low = 0;
    let high = days.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (days[middle] < value) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** Days between two day numbers, both included. */
export function countBetween(days, from, to) {
    return to < from ? 0 : lowerBound(days, to + 1) - lowerBound(days, from);
}

/** Days used in the window of `windowDays` days ending on `day` (Schengen: the last 180). */
export function usedOn(days, day, windowDays) {
    return countBetween(days, day - windowDays + 1, day);
}

/** Every day on which the window ending that day holds more than `maxDays` days. */
export function breaches(days, { maxDays, windowDays }) {
    const over = [];
    let start = 0;
    for (let index = 0; index < days.length; index += 1) {
        while (days[start] <= days[index] - windowDays) start += 1;
        if (index - start + 1 > maxDays) over.push(days[index]);
    }
    return over;
}

function mergeDays(days, from, to) {
    const set = new Set(days);
    for (let day = from; day <= to; day += 1) set.add(day);
    return [...set].sort((a, b) => a - b);
}

/**
 * The longest stay starting on `entry` (a day number) that breaks no window: no day of the
 * stay, and no later recorded day, goes over the limit because of it. Returns
 * { days, lastDay } with 0 days when entering that day is already too much.
 */
export function maxStayFrom(days, rule, entry) {
    const { maxDays, windowDays } = rule;
    // Only days within one window of the stay can change the outcome.
    const nearby = days.slice(lowerBound(days, entry - windowDays + 1), lowerBound(days, entry + maxDays + windowDays));
    const overAfterEntry = list => breaches(list, rule).filter(day => day >= entry).length;
    const baseline = overAfterEntry(nearby);
    let length = 0;
    while (length < maxDays && overAfterEntry(mergeDays(nearby, entry, entry + length)) === baseline) length += 1;
    return { days: length, lastDay: length ? entry + length - 1 : null };
}

/** Where a stay rule stands on `today` (YYYY-MM-DD). */
export function stayStatus(days, rule, today) {
    const now = dayNumber(today);
    const used = usedOn(days, now, rule.windowDays);
    const over = breaches(days, rule);
    return {
        used,
        remaining: Math.max(0, rule.maxDays - used),
        inside: countBetween(days, now, now) > 0,
        breaches: over,
        // Breaches still inside the current window are the ones that matter today.
        recentBreach: over.find(day => day > now - rule.windowDays && day <= now) ?? null,
        stay: maxStayFrom(days, rule, now)
    };
}

/** The counting period holding `day`: a year from `yearStart` (MM-DD) or a rolling window. */
export function periodOf(threshold, day) {
    if (threshold.period === 'rolling') return { from: day - threshold.windowDays + 1, to: day };
    const [month, date] = (threshold.yearStart || '01-01').split('-').map(Number);
    const startOf = year => Date.UTC(year, month - 1, date) / DAY_MS;
    let year = new Date(day * DAY_MS).getUTCFullYear();
    if (startOf(year) > day) year -= 1;
    return { from: startOf(year), to: startOf(year + 1) - 1 };
}

/**
 * Where a threshold stands on `today` for the given countries counted together:
 * days so far in the current period, and the day it is (or will be) reached from the
 * recorded days, continuing any stay that is still going on.
 */
export function thresholdStatus(ledger, threshold, countryIds, today) {
    const now = dayNumber(today);
    const days = daysIn(ledger, countryIds);
    const period = periodOf(threshold, now);
    const count = countBetween(days, period.from, now);
    const stillThere = countryIds.some(id => ledger.ongoing.has(id));
    let reachDay = null;

    if (threshold.period === 'rolling') {
        // The window moves with the day: look one window ahead.
        const extended = stillThere ? mergeDays(days, now, now + threshold.windowDays) : days;
        for (let day = now; day <= now + threshold.windowDays; day += 1) {
            if (usedOn(extended, day, threshold.windowDays) >= threshold.maxDays) {
                reachDay = day;
                break;
            }
        }
    } else {
        const inPeriod = days.slice(lowerBound(days, period.from), lowerBound(days, period.to + 1));
        const projected = stillThere ? mergeDays(inPeriod, now, period.to) : inPeriod;
        if (projected.length >= threshold.maxDays) reachDay = projected[threshold.maxDays - 1];
    }

    let status = 'ok';
    if (count >= threshold.maxDays) status = 'reached';
    else if (reachDay !== null || threshold.maxDays - count <= threshold.warnDays) status = 'warning';
    return {
        count,
        remaining: Math.max(0, threshold.maxDays - count),
        period: { from: isoDay(period.from), to: isoDay(period.to) },
        reachDate: reachDay === null ? null : isoDay(reachDay),
        stillThere,
        status
    };
}

/** Days per country between two dates (YYYY-MM-DD, both included), most days first. */
export function countryCounters(ledger, from, to) {
    const start = dayNumber(from);
    const end = dayNumber(to);
    return [...ledger.countries.keys()]
        .map(countryId => ({ countryId, days: countBetween(daysIn(ledger, [countryId]), start, end) }))
        .filter(row => row.days > 0)
        .sort((a, b) => b.days - a.days || a.countryId.localeCompare(b.countryId));
}

const sourceKey = source => (source.kind === 'planned' ? `p${source.plannedId}` : `v${source.visitId}`);

/**
 * The timeline: unbroken runs of days in each country, newest first, with the places and
 * visits behind them, so a city stay shows inside its country's stay.
 */
export function countryStays(ledger) {
    const stays = [];
    for (const [countryId, map] of ledger.countries) {
        const days = daysIn(ledger, [countryId]);
        let runStart = 0;
        for (let index = 0; index < days.length; index += 1) {
            if (index + 1 < days.length && days[index + 1] === days[index] + 1) continue;
            const sources = new Map();
            for (let k = runStart; k <= index; k += 1) {
                for (const source of map.get(days[k])) sources.set(sourceKey(source), source);
            }
            const list = [...sources.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.place.localeCompare(b.place));
            stays.push({
                countryId,
                from: isoDay(days[runStart]),
                to: isoDay(days[index]),
                days: index - runStart + 1,
                sources: list,
                ongoing: list.some(source => source.open === 'ongoing'),
                unrecorded: list.some(source => source.open === 'unrecorded'),
                planned: list.every(source => source.kind === 'planned')
            });
            runStart = index + 1;
        }
    }
    return stays.sort((a, b) => b.to.localeCompare(a.to) || b.from.localeCompare(a.from) || a.countryId.localeCompare(b.countryId));
}

// ---------------------------------------------------------------- rules and plans

/** The rules that apply: the built-in ones first, then the traveler's own. */
export function stayRules(settings) {
    return [SCHENGEN_RULE, ...(settings?.rules || []).filter(rule => rule.kind === 'stay')];
}

export function thresholdRules(settings) {
    return (settings?.rules || []).filter(rule => rule.kind === 'threshold');
}

function ledgerCache(markers, countryOf, settings, today) {
    const cache = new Map();
    return (dayRule, withPlans = false) => {
        const key = `${dayRule}|${withPlans}`;
        if (!cache.has(key)) {
            cache.set(key, buildLedger(markers, countryOf, { dayRule, today, planned: withPlans ? settings.planned || [] : [] }));
        }
        return cache.get(key);
    };
}

/**
 * Everything the ledger screen shows, computed once: the main ledger under the traveler's
 * day rule, each stay rule and threshold, the timeline, plan outcomes and alerts.
 * `nameOf(countryId)` names countries and `formatDay(iso)` dates in alert messages.
 */
export function ledgerOverview({ markers, countryOf, settings, today, nameOf = id => id, formatDay = iso => iso }) {
    const dayRule = settings?.dayRule || 'presence';
    const ledgerFor = ledgerCache(markers, countryOf, settings || {}, today);
    const ledger = ledgerFor(dayRule);

    const stays = stayRules(settings).map(rule => ({
        rule,
        ...stayStatus(daysIn(ledgerFor(rule.dayRule), rule.countries), rule, today)
    }));

    // The 183-day rule applies to each country with days in the current year.
    const year = periodOf(TAX_RESIDENCY_RULE, dayNumber(today));
    const taxCountries = [...ledger.countries.keys()]
        .filter(id => countBetween(daysIn(ledger, [id]), year.from, year.to) > 0 || ledger.ongoing.has(id))
        .sort();
    const thresholds = [
        ...taxCountries
            .map(id => ({ rule: TAX_RESIDENCY_RULE, countries: [id], ...thresholdStatus(ledger, TAX_RESIDENCY_RULE, [id], today) }))
            .sort((a, b) => b.count - a.count),
        ...thresholdRules(settings).map(rule => ({ rule, countries: rule.countries, ...thresholdStatus(ledger, rule, rule.countries, today) }))
    ];

    const alerts = [];
    for (const item of stays) {
        if (item.recentBreach !== null) {
            alerts.push({ level: 'reached', ruleId: item.rule.id, message: `${item.rule.name}: over the limit on ${formatDay(isoDay(item.recentBreach))}, within the current window.` });
        } else if (item.used > 0 && item.remaining <= item.rule.warnDays) {
            alerts.push({ level: item.remaining ? 'warning' : 'reached', ruleId: item.rule.id, message: `${item.rule.name}: ${item.remaining} of ${item.rule.maxDays} days left today.` });
        }
    }
    for (const item of thresholds) {
        if (item.status === 'ok') continue;
        const label = item.rule.builtIn ? `${nameOf(item.countries[0])}: ${item.rule.maxDays} days` : item.rule.name;
        let message;
        const since = formatDay(item.period.from);
        if (item.status === 'reached') message = `${label} reached (${item.count} days since ${since}).`;
        else if (item.reachDate) message = `${label} would be reached on ${formatDay(item.reachDate)}${item.stillThere ? ' if you stay on' : ''} (${item.count} days so far).`;
        else message = `${label}: ${item.remaining} days to go (${item.count} days since ${since}).`;
        alerts.push({ level: item.status, ruleId: item.rule.id, countries: item.countries, message });
    }

    return {
        dayRule,
        ledger,
        // Schengen and other presence-based stay rules count from this ledger.
        presence: ledgerFor('presence'),
        stays,
        thresholds,
        alerts,
        timeline: countryStays(ledger),
        plans: simulatePlans({ settings: settings || {}, ledgerFor }),
        unrecorded: countOpen(ledger, 'unrecorded'),
        unplaced: ledger.unplaced.length
    };
}

function countOpen(ledger, open) {
    const visits = new Set();
    for (const days of ledger.countries.values()) {
        for (const sources of days.values()) {
            for (const source of sources) if (source.open === open) visits.add(source.visitId);
        }
    }
    return visits.size;
}

/**
 * What planned stays do to each rule they touch: whether a stay rule still holds (and the
 * first day it would not), the days left after the last planned day, and threshold counts
 * for the period of the last planned day.
 */
export function simulatePlans({ settings, ledgerFor }) {
    const planned = settings.planned || [];
    if (!planned.length) return { stays: [], thresholds: [] };
    const touching = countries => planned.filter(stay => countries.includes(stay.countryId));
    const spanOf = stays => ({
        first: Math.min(...stays.map(stay => dayNumber(stay.startDate))),
        last: Math.max(...stays.map(stay => dayNumber(stay.endDate)))
    });

    const stays = [];
    for (const rule of stayRules(settings)) {
        const relevant = touching(rule.countries);
        if (!relevant.length) continue;
        const { first, last } = spanOf(relevant);
        const before = new Set(breaches(daysIn(ledgerFor(rule.dayRule), rule.countries), rule));
        const days = daysIn(ledgerFor(rule.dayRule, true), rule.countries);
        const newBreach = breaches(days, rule).find(day => day >= first && !before.has(day));
        stays.push({
            rule,
            fits: newBreach === undefined,
            firstBreach: newBreach === undefined ? null : isoDay(newBreach),
            lastDay: isoDay(last),
            remaining: Math.max(0, rule.maxDays - usedOn(days, last, rule.windowDays))
        });
    }

    const ledger = ledgerFor(settings.dayRule || 'presence', true);
    const thresholds = [];
    const check = (rule, countries, relevant) => {
        const { last } = spanOf(relevant);
        const period = periodOf(rule, last);
        const count = countBetween(daysIn(ledger, countries), period.from, period.to);
        thresholds.push({ rule, countries, count, period: { from: isoDay(period.from), to: isoDay(period.to) }, reached: count >= rule.maxDays });
    };
    for (const countryId of [...new Set(planned.map(stay => stay.countryId))].sort()) {
        check(TAX_RESIDENCY_RULE, [countryId], touching([countryId]));
    }
    for (const rule of thresholdRules(settings)) {
        const relevant = touching(rule.countries);
        if (relevant.length) check(rule, rule.countries, relevant);
    }
    return { stays, thresholds };
}

// ---------------------------------------------------------------- evidence and history

function spanText(start, end, ongoing, format) {
    if (!start) return '';
    if (end) return end === start ? format(start) : `${format(start)} – ${format(end)}`;
    return ongoing ? `${format(start)} – still there` : `${format(start)} – end not recorded`;
}

/** One line per change of visit dates, as the evidence report lists them (ISO dates by default). */
export function describeChange(change, format = iso => iso) {
    const before = spanText(change.oldStartDate, change.oldEndDate, change.oldOngoing, format);
    const after = spanText(change.newStartDate, change.newEndDate, change.newOngoing, format);
    if (change.action === 'added') return `Added ${after}`;
    if (change.action === 'removed') return `Removed ${before}`;
    return `Changed ${before} → ${after}`;
}

/** Why a day counts, from the visit behind it. */
export function dayNote(source, date) {
    if (source.open === 'unrecorded') return 'End not recorded: first day only';
    const arrival = date === source.startDate;
    if (source.open === 'ongoing') return arrival ? 'Arrival day; still there' : 'Still there';
    const departure = date === source.endDate;
    if (arrival && departure) return 'Arrival and departure day';
    if (arrival) return 'Arrival day';
    if (departure) return 'Departure day';
    return 'During the stay';
}

/**
 * Day-by-day evidence for some countries between two dates: one row per day and country,
 * with the visits it comes from and the history of their dates. `changes` is the
 * history from the API, newest first.
 */
export function evidenceReport(ledger, { countryIds, from, to, changes = [] }) {
    const start = dayNumber(from);
    const end = dayNumber(to);
    const byVisit = new Map();
    for (const change of [...changes].reverse()) {
        if (!byVisit.has(change.visitId)) byVisit.set(change.visitId, []);
        byVisit.get(change.visitId).push(change);
    }

    const rows = [];
    const totals = [];
    const visitIds = new Set();
    for (const countryId of countryIds) {
        const map = ledger.countries.get(countryId);
        const days = daysIn(ledger, [countryId]).filter(day => day >= start && day <= end);
        totals.push({ countryId, days: days.length });
        for (const day of days) {
            const date = isoDay(day);
            const sources = map.get(day).filter(source => source.kind === 'visit');
            for (const source of sources) visitIds.add(source.visitId);
            rows.push({
                date,
                countryId,
                sources: sources.map(source => {
                    const visitChanges = byVisit.get(source.visitId) || [];
                    return {
                        ...source,
                        note: dayNote(source, date),
                        history: visitChanges.map(change => describeChange(change)),
                        edited: visitChanges.some(change => change.action === 'changed')
                    };
                })
            });
        }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.countryId.localeCompare(b.countryId));

    // Changes to these visits, and removals of visits that held days in the period.
    const overlaps = change => change.oldStartDate && change.oldStartDate <= to && (change.oldEndDate || change.oldStartDate) >= from;
    const history = changes
        .filter(change => visitIds.has(change.visitId) || (change.action === 'removed' && overlaps(change)))
        .sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.id - b.id);

    return { dayRule: ledger.dayRule, from, to, countryIds: [...countryIds], rows, totals, changes: history };
}

export const EVIDENCE_FIELDS = ['date', 'country', 'place', 'kind', 'visitFirstDay', 'visitLastDay', 'visitId', 'note', 'dayRule', 'dateHistory'];

function csvField(value) {
    let text = String(value ?? '');
    // Spreadsheets run cells starting with these as formulas; place names are user text.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

/** The evidence as CSV: one row per day, country and visit. */
export function buildEvidenceCsv(report, nameOf = id => id) {
    const rows = [EVIDENCE_FIELDS];
    for (const row of report.rows) {
        for (const source of row.sources) {
            rows.push([
                row.date,
                nameOf(row.countryId),
                source.place,
                source.category,
                source.startDate,
                source.endDate || (source.ongoing ? 'still there' : ''),
                source.visitId,
                source.note,
                DAY_RULES[report.dayRule].label,
                source.history.join('; ')
            ]);
        }
    }
    return rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- editing rules and plans

/** Country ids from a comma-separated list of names or codes; "Schengen" adds the area. */
export function parseCountryList(text, findCountry) {
    const ids = [];
    const unknown = [];
    for (const part of String(text ?? '').split(/[,;\n]+/).map(item => item.trim()).filter(Boolean)) {
        if (/^schengen( area)?$/i.test(part)) {
            ids.push(...SCHENGEN_AREA);
            continue;
        }
        const country = findCountry(part);
        if (country) ids.push(country.id);
        else unknown.push(part);
    }
    return { ids: [...new Set(ids)], unknown };
}

function whole(value) {
    const text = String(value ?? '').trim();
    return /^\d{1,5}$/.test(text) ? Number(text) : NaN;
}

const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Validates a rule from the rule form the way the API does; returns { rule } or { error }. */
export function checkRule(record, countries) {
    const name = String(record?.name ?? '').trim();
    if (!name || name.length > 80) return { error: 'Give the rule a name of up to 80 characters.' };
    if (!countries?.length) return { error: 'Choose at least one country.' };
    if (countries.length > 80) return { error: 'A rule can cover at most 80 countries.' };
    const maxDays = whole(record.maxDays);
    const windowDays = whole(record.windowDays);
    const warnDays = whole(record.warnDays || '0');
    if (!inRange(warnDays, 0, 365)) return { error: 'Warn days must be a whole number from 0 to 365.' };
    const base = { id: record.id, kind: record.kind, name, countries };

    if (record.kind === 'stay') {
        if (!inRange(windowDays, 1, 3660)) return { error: 'The window must be 1 to 3,660 days.' };
        if (!inRange(maxDays, 1, windowDays)) return { error: 'Allowed days must be at least 1 and no more than the window.' };
        const dayRule = DAY_RULES[record.dayRule] ? record.dayRule : 'presence';
        return { rule: { ...base, maxDays, windowDays, warnDays, dayRule } };
    }
    if (record.period === 'rolling') {
        if (!inRange(windowDays, 1, 3660)) return { error: 'The window must be 1 to 3,660 days.' };
        if (!inRange(maxDays, 1, windowDays)) return { error: 'Threshold days must be at least 1 and no more than the window.' };
        return { rule: { ...base, maxDays, period: 'rolling', windowDays, warnDays } };
    }
    const yearStart = String(record.yearStart || '01-01').trim();
    if (!/^\d{2}-\d{2}$/.test(yearStart) || !isValidDate(`2001-${yearStart}`)) {
        return { error: 'The year starts on a MM-DD day such as 01-01 or 04-06.' };
    }
    if (!inRange(maxDays, 1, 366)) return { error: 'Threshold days must be from 1 to 366.' };
    return { rule: { ...base, maxDays, period: 'year', yearStart, warnDays } };
}

export function checkPlannedStay(record) {
    const stay = {
        id: record?.id,
        countryId: String(record?.countryId ?? ''),
        startDate: String(record?.startDate ?? '').trim(),
        endDate: String(record?.endDate ?? '').trim()
    };
    if (!/^[A-Z]{3}$/.test(stay.countryId)) return { error: 'Choose the country of the planned stay.' };
    if (!isValidDate(stay.startDate) || !isValidDate(stay.endDate)) return { error: 'Choose the first and last day of the planned stay.' };
    if (stay.endDate < stay.startDate) return { error: 'The planned stay must end on or after the day it starts.' };
    if (dayNumber(stay.endDate) - dayNumber(stay.startDate) >= 3660) return { error: 'A planned stay can last at most 3,660 days.' };
    return { stay };
}

/** A short random id for rules and planned stays. */
export function newId(random = Math.random) {
    return `${Date.now().toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}
