// Organizations in the browser (ADR 0029, ADR 0030): invitation links, the purpose of a visit,
// the employer's report as CSV, and the pre-trip checklist of a business trip. Pure functions,
// unit tested in Node.
import { csvField } from './ledger-evidence.js';
import { addDays } from './days.js';
import { PACKING_MAX_ITEMS } from './trip-budget.js';
import { t } from './i18n.js';

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** The address an invitation token opens. */
export const invitationLink = (origin, token) => `${origin}/#join=${token}`;

/** The token in a pasted invitation link, or the token itself; null when neither. */
export function invitationToken(text) {
    const value = String(text ?? '').trim();
    const token = value.includes('#join=') ? value.slice(value.indexOf('#join=') + 6) : value;
    return TOKEN.test(token) ? token : null;
}

/** A visit's purpose as a form value: "personal", or "business:<organization id>". */
export const purposeValue = visit => (visit?.purpose === 'business' && visit.organizationId ? `business:${visit.organizationId}` : 'personal');

/** The purpose and organization of a form value, as the API reads them. */
export function readPurpose(value) {
    const [purpose, id] = String(value ?? '').split(':');
    return purpose === 'business' && Number(id) > 0 ? { purpose, organizationId: Number(id) } : { purpose: 'personal', organizationId: null };
}

export const REPORT_FIELDS = ['member', 'role', 'kind', 'item', 'days', 'limit', 'status'];

/** The report as CSV for an adviser: a row per member and country, and per member and rule. */
export function buildReportCsv(report) {
    const rows = [REPORT_FIELDS];
    for (const member of report.members) {
        for (const country of member.countries) rows.push([member.username, member.role, 'country', country.name, country.days, '', '']);
        for (const rule of member.rules) rows.push([member.username, member.role, rule.kind, rule.name, rule.count, rule.maxDays, rule.status]);
    }
    return rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- pre-trip checklists

/** Checks a checklist item from the admin's form the way the API does: { item } or { error }. */
export function checkChecklistItem(record, countries) {
    const task = String(record?.task ?? '').trim();
    if (!task || task.length > 80) return { error: t('Name the task in 1 to 80 characters.') };
    if (!countries.length) return { error: t('Name at least one country it is for.') };
    if (countries.length > 80) return { error: t('An item is for at most 80 countries.') };
    const daysBefore = Number(String(record?.daysBefore ?? '').trim() || '0');
    if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365) return { error: t('Days before the trip must be a whole number from 0 to 365.') };
    const link = String(record?.link ?? '').trim();
    if (link && (link.length > 2048 || !/^https?:\/\/[^\s]+$/i.test(link))) return { error: t('The link must be an HTTP or HTTPS address.') };
    return { item: { id: record.id, task, countries, daysBefore, link: link || null } };
}

const sameTask = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The checklist of a business trip: the items of its organization for the trip's countries,
 * each with its due date (when the trip is dated), its state on the packing list (`done` when
 * packed, `listed`, or `missing`) and whether it is overdue on `today`. Null for a personal trip
 * or one whose organization asks nothing for those countries.
 */
export function tripChecklist({ trip, orgs, countryIds, today }) {
    const org = trip.organizationId ? orgs.find(item => item.id === trip.organizationId) : null;
    const countries = new Set(countryIds);
    const items = (org?.checklist || []).filter(item => item.countries.some(id => countries.has(id)));
    if (!items.length) return null;
    const packing = trip.packing || [];
    return {
        org,
        items: items.map(item => {
            const entry = packing.find(candidate => sameTask(candidate.item, item.task));
            const state = entry ? (entry.packed ? 'done' : 'listed') : 'missing';
            const due = trip.startDate ? addDays(trip.startDate, -item.daysBefore) : null;
            return { item, state, due, overdue: Boolean(due && due < today && state !== 'done') };
        })
    };
}

/** The packing list with the checklist's tasks it does not have yet, unpacked. */
export function withChecklistItems(packing, items) {
    const added = items.filter(({ item }) => !packing.some(entry => sameTask(entry.item, item.task))).map(({ item }) => ({ item: item.task, packed: false }));
    return [...packing, ...added].slice(0, PACKING_MAX_ITEMS);
}
