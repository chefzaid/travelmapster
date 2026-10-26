// Organizations in the browser (ADR 0029): invitation links, the purpose of a visit and the
// employer's report as CSV. Pure functions, unit tested in Node.
import { csvField } from './ledger-evidence.js';

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
