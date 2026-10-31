// Ledger health: what would make the record doubtful when it matters, found in the ledger
// itself. Visits whose end was never recorded, a stay marked "still there" although the
// traveler has been elsewhere since, and two countries far apart on the same days for longer
// than a travel day. Pure, unit tested in Node.
import { isoDay } from './days.js';

const visitSources = ledger => {
    const byVisit = new Map();
    for (const days of ledger.countries.values()) {
        for (const sources of days.values()) {
            for (const source of sources) if (source.kind === 'visit' && !byVisit.has(source.visitId)) byVisit.set(source.visitId, source);
        }
    }
    return [...byVisit.values()];
};

/**
 * The ledger's doubtful entries, `{ unrecorded, stillThere, clashes }`:
 * - unrecorded: visits without an end, counted on their first day only;
 * - stillThere: `{ visit, since }`, a visit still going on with a later visit to a country
 *   not next to it (`since` the first such);
 * - clashes: `{ countries: [a, b], from, to, days }`, two countries that do not border each
 *   other on two or more consecutive days, which no single journey explains.
 * `areNeighbors(a, b)` says whether two countries share a land border.
 * @param {{ countries: Map<string, Map<number, any[]>> }} ledger
 * @param {{ areNeighbors?: (a: string, b: string) => boolean }} [options]
 */
export function ledgerHealth(ledger, { areNeighbors = () => false } = {}) {
    const visits = visitSources(ledger).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.place.localeCompare(b.place));
    const unrecorded = visits.filter(visit => visit.open === 'unrecorded');
    const apart = (a, b) => a !== b && !areNeighbors(a, b);

    const stillThere = visits.filter(visit => visit.open === 'ongoing').flatMap(visit => {
        const since = visits.find(other => other.startDate > visit.startDate && apart(other.countryId, visit.countryId));
        return since ? [{ visit, since }] : [];
    });

    // Days on which each pair of countries far apart both have a visit, in runs.
    const pairDays = new Map();
    const byDay = new Map();
    for (const [countryId, days] of ledger.countries) {
        for (const [day, sources] of days) {
            if (!sources.some(source => source.kind === 'visit')) continue;
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day).push(countryId);
        }
    }
    for (const [day, countries] of byDay) {
        countries.sort();
        for (let i = 0; i < countries.length; i += 1) {
            for (let j = i + 1; j < countries.length; j += 1) {
                if (!apart(countries[i], countries[j])) continue;
                const key = `${countries[i]}|${countries[j]}`;
                if (!pairDays.has(key)) pairDays.set(key, []);
                pairDays.get(key).push(day);
            }
        }
    }
    const clashes = [];
    for (const [key, days] of pairDays) {
        days.sort((a, b) => a - b);
        let start = 0;
        for (let i = 0; i < days.length; i += 1) {
            if (i + 1 < days.length && days[i + 1] === days[i] + 1) continue;
            if (i - start + 1 >= 2) clashes.push({ countries: key.split('|'), from: isoDay(days[start]), to: isoDay(days[i]), days: i - start + 1 });
            start = i + 1;
        }
    }
    clashes.sort((a, b) => a.from.localeCompare(b.from) || a.countries.join().localeCompare(b.countries.join()));
    return { unrecorded, stillThere, clashes };
}

/** How many doubtful entries the ledger has. */
export const healthCount = ({ unrecorded, stillThere, clashes }) => unrecorded.length + stillThere.length + clashes.length;
