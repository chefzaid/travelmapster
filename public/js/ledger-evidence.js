// Day ledger evidence (ADR 0010): one row per day, country and visit, with why the day counts
// and the history of the visit's dates, for the report and its CSV.
import { DAY_RULES, dayNumber, daysIn, isoDay } from './days.js';
import { t } from './i18n.js';
function spanText(start, end, ongoing, format) {
    if (!start) return '';
    if (end) return end === start ? format(start) : `${format(start)} – ${format(end)}`;
    return ongoing ? t('{date} – still there', { date: format(start) }) : t('{date} – end not recorded', { date: format(start) });
}

/** One line per change of visit dates, as the evidence report lists them (ISO dates by default). */
export function describeChange(change, format = iso => iso) {
    const before = spanText(change.oldStartDate, change.oldEndDate, change.oldOngoing, format);
    const after = spanText(change.newStartDate, change.newEndDate, change.newOngoing, format);
    if (change.action === 'added') return t('Added {dates}', { dates: after });
    if (change.action === 'removed') return t('Removed {dates}', { dates: before });
    return t('Changed {before} → {after}', { before, after });
}

/** Why a day counts, from the visit behind it. */
export function dayNote(source, date) {
    if (source.open === 'unrecorded') return t('End not recorded: first day only');
    const arrival = date === source.startDate;
    if (source.open === 'ongoing') return arrival ? t('Arrival day; still there') : t('Still there');
    const departure = date === source.endDate;
    if (arrival && departure) return t('Arrival and departure day');
    if (arrival) return t('Arrival day');
    if (departure) return t('Departure day');
    return t('During the stay');
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

/** A quoted CSV cell; cells that spreadsheets would run as formulas are defused. */
export function csvField(value) {
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

