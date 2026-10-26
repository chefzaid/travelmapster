// Running an organization (ADR 0029), for its managers and admins: the business-day report with
// its CSV, members and roles, invitation links, the employer's rules, renaming and deleting.
import { h, toast, formDialog, formatDate, downloadFile, copyText, steppedDialog, STAY_CLOSED } from './ui.js';
import { buildReportCsv, invitationLink } from './org-data.js';
import { ruleDialog } from './ledger.js';
import { countryName } from './ledger-report.js';
import { statusChip } from './ledger-parts.js';
import { openSecurity } from './security.js';
import { checklistSection } from './org-checklist.js';

const ROLE_LABELS = { traveler: 'Traveler', manager: 'Manager', admin: 'Admin' };
const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

export const roleLabel = role => ROLE_LABELS[role] || role;

/**
 * Errors of the organization dialogs: managers and admins without a second factor are offered
 * one, in Sign-in security instead of the dialog.
 */
export async function orgError(ctx, error) {
    if (error.data?.code !== 'second_factor_required') {
        ctx.handleError(error);
        return undefined;
    }
    const agreed = await ctx.confirmDialog({ title: 'Secure your account first', message: error.message, confirmLabel: 'Open sign-in security' });
    if (!agreed) return undefined;
    await openSecurity(ctx);
    return STAY_CLOSED;
}

function thisYear() {
    const year = new Date().getFullYear();
    return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function ruleSummary(ctx, rule) {
    const countries = rule.countries.map(id => countryName(ctx, id)).join(', ');
    if (rule.kind === 'stay') return `${rule.maxDays} days in any ${rule.windowDays} · ${countries}`;
    const period = rule.period === 'rolling' ? `in any ${rule.windowDays} days` : `a year from ${rule.yearStart || '01-01'}`;
    return `${rule.maxDays} days ${period} · ${countries}`;
}

// ---------------------------------------------------------------- the report

function reportTable(report) {
    return h('div', { class: 'org-report' }, h('table', {},
        h('caption', { class: 'small' }, `Business days from ${formatDate(report.from)} to ${formatDate(report.to)}`),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Member'), h('th', { scope: 'col' }, 'Days per country'), h('th', { scope: 'col' }, 'Rules'))),
        h('tbody', {}, report.members.map(member => h('tr', {},
            h('th', { scope: 'row' }, member.username),
            h('td', {}, member.countries.length ? member.countries.map(country => `${country.name} ${country.days}`).join(' · ') : '—'),
            h('td', {}, member.rules.map(rule => h('div', {}, `${rule.name}: ${rule.count}/${rule.maxDays} `, statusChip(rule.status))))
        )))));
}

function reportSection(org, view, step) {
    const from = h('input', { id: 'org-report-from', type: 'date', value: view.period.from, required: true });
    const to = h('input', { id: 'org-report-to', type: 'date', value: view.period.to, required: true });
    const show = () => step(async () => {
        view.period = { from: from.value, to: to.value };
        view.report = await view.load(view.period);
    });
    const fileName = `${org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization'}-business-days-${view.report?.from}-${view.report?.to}.csv`;
    return h('section', { class: 'dialog-section', 'aria-labelledby': 'org-report-title' },
        h('h4', { id: 'org-report-title' }, '📊 Business days'),
        h('p', { class: 'small' }, 'Each member\'s business trips for this organization, per country, and its rules. Members see in their account each time you look.'),
        h('div', { class: 'org-period' },
            h('label', { class: 'field', for: 'org-report-from' }, h('span', {}, 'From'), from),
            h('label', { class: 'field', for: 'org-report-to' }, h('span', {}, 'To'), to),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: show }, 'Show business days')),
        view.report ? [
            reportTable(view.report),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => downloadFile(fileName, buildReportCsv(view.report), 'text/csv') }, '⬇️ CSV for your adviser')
        ] : null);
}

// ---------------------------------------------------------------- members and invitations

function memberItem(ctx, org, member, step) {
    const self = member.username === ctx.state.user.username;
    const admin = org.role === 'admin';
    return h('li', { class: 'dialog-item' },
        h('span', {}, h('strong', {}, member.username, self ? ' (you)' : ''), h('small', {}, `${roleLabel(member.role)} · joined ${formatDate(member.joinedAt.slice(0, 10))}`)),
        admin && !self ? h('select', {
            'aria-label': `Role of ${member.username}`,
            onchange: event => step(async () => {
                await ctx.api.setOrgRole(org.id, member.username, event.target.value);
                toast(`${member.username} is now ${roleLabel(event.target.value).toLowerCase()}.`, { tone: 'success' });
            })
        }, ROLE_OPTIONS.map(option => h('option', { value: option.value, selected: option.value === member.role }, option.label))) : null,
        admin && !self ? h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `Remove ${member.username}`, title: 'Remove',
            onclick: () => step(async () => {
                if (!(await ctx.confirmDialog({ title: `Remove ${member.username}?`, message: 'Their business trips for this organization become personal again.', confirmLabel: 'Remove', danger: true }))) return;
                await ctx.api.removeOrgMember(org.id, member.username);
                toast(`Removed ${member.username}.`);
            })
        }, '✕') : null);
}

async function invite(ctx, org) {
    const values = await formDialog({
        title: `Invite to ${org.name}`,
        message: 'The link works once, for seven days. Send it to the person you invite as you like.',
        submitLabel: 'Make the link',
        fields: [{ name: 'role', label: 'They join as', type: 'select', value: 'traveler', options: ROLE_OPTIONS }]
    });
    if (!values) return;
    const invitation = await ctx.api.inviteToOrg(org.id, values.role);
    const link = invitationLink(location.origin, invitation.token);
    await formDialog({
        title: 'Invitation link',
        message: 'Copy it now: it is shown only once.',
        content: [
            h('code', { class: 'invitation-link' }, link),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => copyText(link, 'Invitation link copied.', `Invitation link: ${link}`) }, '📋 Copy the link')
        ],
        submitLabel: 'Done',
        fields: []
    });
}

function invitationsSection(ctx, org, invitations, step) {
    return h('section', { class: 'dialog-section', 'aria-labelledby': 'org-invitations-title' },
        h('h4', { id: 'org-invitations-title' }, '✉️ Invitations'),
        invitations.length ? h('ul', { class: 'dialog-list' }, invitations.map(invitation => h('li', { class: 'dialog-item' },
            h('span', {}, h('strong', {}, `For a ${roleLabel(invitation.role).toLowerCase()}`), h('small', {}, `Until ${formatDate(invitation.expiresAt.slice(0, 10))}`)),
            h('button', {
                type: 'button', class: 'btn btn-danger-ghost btn-sm',
                onclick: () => step(async () => {
                    await ctx.api.revokeOrgInvitation(org.id, invitation.id);
                    toast('Invitation revoked: its link no longer works.');
                })
            }, 'Revoke')))) : h('p', { class: 'muted small' }, 'No invitation waiting.'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => step(() => invite(ctx, org)) }, '＋ Invite someone'));
}

// ---------------------------------------------------------------- rules

function rulesSection(ctx, org, step) {
    const admin = org.role === 'admin';
    const save = rules => ctx.api.saveOrgRules(org.id, rules);
    const edit = (kind, rule) => step(async () => {
        const checked = await ruleDialog(ctx, kind, rule);
        if (!checked) return;
        await save(rule ? org.rules.map(item => (item.id === rule.id ? checked : item)) : [...org.rules, checked]);
        toast(`Saved ${checked.name}.`, { tone: 'success' });
    });
    const remove = rule => step(async () => {
        await save(org.rules.filter(item => item.id !== rule.id));
        toast(`Removed ${rule.name}.`);
    });
    return h('section', { class: 'dialog-section', 'aria-labelledby': 'org-rules-title' },
        h('h4', { id: 'org-rules-title' }, '📏 Rules'),
        h('p', { class: 'small' }, 'Stay limits and thresholds that matter to the organization, such as social security or tax days. Members see them in their Ledger tab.'),
        org.rules.length ? h('ul', { class: 'dialog-list' }, org.rules.map(rule => h('li', { class: 'dialog-item' },
            h('span', {}, h('strong', {}, rule.name), h('small', {}, ruleSummary(ctx, rule))),
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${rule.name}`, title: 'Edit', onclick: () => edit(rule.kind, rule) }, '✏️') : null,
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${rule.name}`, title: 'Remove', onclick: () => remove(rule) }, '🗑️') : null
        ))) : h('p', { class: 'muted small' }, 'No rules yet.'),
        admin && org.rules.length < 20 ? h('div', { class: 'dialog-buttons' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => edit('stay') }, '＋ Stay rule'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => edit('threshold') }, '＋ Threshold')) : null);
}

// ---------------------------------------------------------------- the organization itself

async function rename(ctx, org) {
    const values = await formDialog({ title: `Rename ${org.name}`, submitLabel: 'Rename', fields: [{ name: 'name', label: 'Name', value: org.name, required: true, maxlength: 80 }] });
    if (values) await ctx.api.renameOrg(org.id, values.name.trim());
}

async function remove(ctx, org, back) {
    const agreed = await ctx.confirmDialog({
        title: `Delete ${org.name}?`,
        message: 'Its members, invitations, rules and audit log go; every business trip for it becomes personal again. This cannot be undone.',
        confirmLabel: 'Delete organization', danger: true
    });
    if (!agreed) return undefined;
    await ctx.api.deleteOrg(org.id);
    toast(`Deleted ${org.name}.`);
    await ctx.reloadMarkers();
    back();
    return STAY_CLOSED;
}

/** The dialog that runs an organization; `back` opens the Organizations dialog again. */
export function manageOrg(ctx, org, back) {
    // The report is loaded on request only: each look is written to the members' audit log.
    const view = { period: thisYear(), report: null, load: period => ctx.api.getOrgReport(org.id, period) };
    return steppedDialog({
        labelledBy: 'org-manage-title',
        load: async () => {
            // The app's own copy follows: the Ledger and Trips tabs count the rules and checklist.
            ctx.state.orgs = await ctx.api.getOrgs();
            ctx.renderActiveTab();
            const current = ctx.state.orgs.find(item => item.id === org.id);
            if (!current || current.role === 'traveler') throw new Error(`You no longer run ${org.name}.`);
            const [members, invitations] = await Promise.all([
                ctx.api.getOrgMembers(org.id),
                current.role === 'admin' ? ctx.api.getOrgInvitations(org.id) : []
            ]);
            return { current, members, invitations };
        },
        onError: error => orgError(ctx, error),
        draw: ({ current, members, invitations }, step, close) => [
            h('h3', { id: 'org-manage-title' }, current.name),
            h('p', { class: 'small muted' }, `You are ${roleLabel(current.role).toLowerCase()} · ${members.length} ${members.length === 1 ? 'member' : 'members'}`),
            reportSection(current, view, step),
            h('section', { class: 'dialog-section', 'aria-labelledby': 'org-members-title' },
                h('h4', { id: 'org-members-title' }, '👥 Members'),
                h('ul', { class: 'dialog-list' }, members.map(member => memberItem(ctx, current, member, step)))),
            current.role === 'admin' ? invitationsSection(ctx, current, invitations, step) : null,
            rulesSection(ctx, current, step),
            checklistSection(ctx, current, step),
            current.role === 'admin' ? h('div', { class: 'dialog-buttons dialog-section' },
                h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => step(() => rename(ctx, current)) }, '✏️ Rename'),
                h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: () => step(() => remove(ctx, current, back)) }, '🗑️ Delete')) : null,
            h('div', { class: 'dialog-actions' }, h('button', {
                type: 'button', class: 'btn btn-primary',
                onclick: () => {
                    close();
                    back();
                }
            }, 'Back'))
        ]
    });
}
