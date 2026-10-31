// Running an organization (ADR 0029), for its managers and admins: the business-day report with
// its CSV, members and roles, invitation links, the employer's rules, renaming and deleting.
import { h, toast, formDialog, formatDate, downloadFile, copyText, steppedDialog, STAY_CLOSED } from './ui.js';
import { buildReportCsv, invitationLink } from './org-data.js';
import { openSecurity, ruleDialog } from './lazy.js';
import { countryName } from './ledger-report.js';
import { statusChip } from './ledger-parts.js';
import { checklistSection } from './org-checklist.js';
import { joinList, t, tk, tn } from './i18n.js';

const ROLE_LABELS = { traveler: tk('Traveler'), manager: tk('Manager'), admin: tk('Admin') };
const roleOptions = () => Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label: t(label) }));

export const roleLabel = role => (ROLE_LABELS[role] ? t(ROLE_LABELS[role]) : role);

/**
 * Errors of the organization dialogs: managers and admins without a second factor are offered
 * one, in Sign-in security instead of the dialog.
 */
export async function orgError(ctx, error) {
    if (error.data?.code !== 'second_factor_required') {
        ctx.handleError(error);
        return undefined;
    }
    const agreed = await ctx.confirmDialog({ title: t('Secure your account first'), message: error.message, confirmLabel: t('Open sign-in security') });
    if (!agreed) return undefined;
    await openSecurity(ctx);
    return STAY_CLOSED;
}

function thisYear() {
    const year = new Date().getFullYear();
    return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function ruleSummary(ctx, rule) {
    const countries = joinList(rule.countries.map(id => countryName(ctx, id)));
    if (rule.kind === 'stay') return t('{maxDays} days in any {windowDays} · {countries}', { maxDays: rule.maxDays, windowDays: rule.windowDays, countries });
    if (rule.period === 'rolling') return t('{maxDays} days in any {windowDays} days · {countries}', { maxDays: rule.maxDays, windowDays: rule.windowDays, countries });
    return t('{maxDays} days a year from {date} · {countries}', { maxDays: rule.maxDays, date: rule.yearStart || '01-01', countries });
}

// ---------------------------------------------------------------- the report

function reportTable(report) {
    return h('div', { class: 'org-report' }, h('table', {},
        h('caption', { class: 'small' }, t('Business days from {from} to {to}', { from: formatDate(report.from), to: formatDate(report.to) })),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('Member')), h('th', { scope: 'col' }, t('Days per country')), h('th', { scope: 'col' }, t('Rules')))),
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
        h('h4', { id: 'org-report-title' }, t('📊 Business days')),
        h('p', { class: 'small' }, t('Each member\'s business trips for this organization, per country, and its rules. Members see in their account each time you look.')),
        h('div', { class: 'org-period' },
            h('label', { class: 'field', for: 'org-report-from' }, h('span', {}, t('From')), from),
            h('label', { class: 'field', for: 'org-report-to' }, h('span', {}, t('To')), to),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: show }, t('Show business days'))),
        view.report ? [
            reportTable(view.report),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => downloadFile(fileName, buildReportCsv(view.report), 'text/csv') }, t('⬇️ CSV for your adviser'))
        ] : null);
}

// ---------------------------------------------------------------- members and invitations

function memberItem(ctx, org, member, step) {
    const self = member.username === ctx.state.user.username;
    const admin = org.role === 'admin';
    return h('li', { class: 'dialog-item' },
        h('span', {}, h('strong', {}, member.username, self ? ` ${t('(you)')}` : ''), h('small', {}, t('{role} · joined {date}', { role: roleLabel(member.role), date: formatDate(member.joinedAt.slice(0, 10)) }))),
        admin && !self ? h('select', {
            'aria-label': t('Role of {username}', { username: member.username }),
            onchange: event => step(async () => {
                await ctx.api.setOrgRole(org.id, member.username, event.target.value);
                toast(t('{username}\'s role is now {role}.', { username: member.username, role: roleLabel(event.target.value) }), { tone: 'success' });
            })
        }, roleOptions().map(option => h('option', { value: option.value, selected: option.value === member.role }, option.label))) : null,
        admin && !self ? h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': t('Remove {username}', { username: member.username }), title: t('Remove'),
            onclick: () => step(async () => {
                if (!(await ctx.confirmDialog({ title: t('Remove {username}?', { username: member.username }), message: t('Their business trips for this organization become personal again.'), confirmLabel: t('Remove'), danger: true }))) return;
                await ctx.api.removeOrgMember(org.id, member.username);
                toast(t('Removed {username}.', { username: member.username }));
            })
        }, '✕') : null);
}

async function invite(ctx, org) {
    const values = await formDialog({
        title: t('Invite to {name}', { name: org.name }),
        message: t('The link works once, for seven days. Send it to the person you invite as you like.'),
        submitLabel: t('Make the link'),
        fields: [{ name: 'role', label: t('They join as'), type: 'select', value: 'traveler', options: roleOptions() }]
    });
    if (!values) return;
    const invitation = await ctx.api.inviteToOrg(org.id, values.role);
    const link = invitationLink(location.origin, invitation.token);
    await formDialog({
        title: t('Invitation link'),
        message: t('Copy it now: it is shown only once.'),
        content: [
            h('code', { class: 'invitation-link' }, link),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => copyText(link, t('Invitation link copied.'), t('Invitation link: {link}', { link })) }, t('📋 Copy the link'))
        ],
        submitLabel: t('Done'),
        fields: []
    });
}

function invitationsSection(ctx, org, invitations, step) {
    return h('section', { class: 'dialog-section', 'aria-labelledby': 'org-invitations-title' },
        h('h4', { id: 'org-invitations-title' }, t('✉️ Invitations')),
        invitations.length ? h('ul', { class: 'dialog-list' }, invitations.map(invitation => h('li', { class: 'dialog-item' },
            h('span', {}, h('strong', {}, t('Role: {role}', { role: roleLabel(invitation.role) })), h('small', {}, t('Until {date}', { date: formatDate(invitation.expiresAt.slice(0, 10)) }))),
            h('button', {
                type: 'button', class: 'btn btn-danger-ghost btn-sm',
                onclick: () => step(async () => {
                    await ctx.api.revokeOrgInvitation(org.id, invitation.id);
                    toast(t('Invitation revoked: its link no longer works.'));
                })
            }, t('Revoke'))))) : h('p', { class: 'muted small' }, t('No invitation waiting.')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => step(() => invite(ctx, org)) }, t('＋ Invite someone')));
}

// ---------------------------------------------------------------- rules

function rulesSection(ctx, org, step) {
    const admin = org.role === 'admin';
    const save = rules => ctx.api.saveOrgRules(org.id, rules);
    const edit = (kind, rule) => step(async () => {
        const checked = await ruleDialog(ctx, kind, rule);
        if (!checked) return;
        await save(rule ? org.rules.map(item => (item.id === rule.id ? checked : item)) : [...org.rules, checked]);
        toast(t('Saved {name}.', { name: checked.name }), { tone: 'success' });
    });
    const remove = rule => step(async () => {
        await save(org.rules.filter(item => item.id !== rule.id));
        toast(t('Removed {name}.', { name: rule.name }));
    });
    return h('section', { class: 'dialog-section', 'aria-labelledby': 'org-rules-title' },
        h('h4', { id: 'org-rules-title' }, t('📏 Rules')),
        h('p', { class: 'small' }, t('Stay limits and thresholds that matter to the organization, such as social security or tax days. Members see them in their Ledger tab.')),
        org.rules.length ? h('ul', { class: 'dialog-list' }, org.rules.map(rule => h('li', { class: 'dialog-item' },
            h('span', {}, h('strong', {}, rule.name), h('small', {}, ruleSummary(ctx, rule))),
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Edit {name}', { name: rule.name }), title: t('Edit'), onclick: () => edit(rule.kind, rule) }, '✏️') : null,
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove {name}', { name: rule.name }), title: t('Remove'), onclick: () => remove(rule) }, '🗑️') : null
        ))) : h('p', { class: 'muted small' }, t('No rules yet.')),
        admin && org.rules.length < 20 ? h('div', { class: 'dialog-buttons' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => edit('stay') }, t('＋ Stay rule')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => edit('threshold') }, t('＋ Threshold'))) : null);
}

// ---------------------------------------------------------------- the organization itself

async function rename(ctx, org) {
    const values = await formDialog({ title: t('Rename {name}', { name: org.name }), submitLabel: t('Rename'), fields: [{ name: 'name', label: t('Name'), value: org.name, required: true, maxlength: 80 }] });
    if (values) await ctx.api.renameOrg(org.id, values.name.trim());
}

async function remove(ctx, org, back) {
    const agreed = await ctx.confirmDialog({
        title: t('Delete {name}?', { name: org.name }),
        message: t('Its members, invitations, rules and audit log go; every business trip for it becomes personal again. This cannot be undone.'),
        confirmLabel: t('Delete organization'), danger: true
    });
    if (!agreed) return undefined;
    await ctx.api.deleteOrg(org.id);
    toast(t('Deleted {name}.', { name: org.name }));
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
            if (!current || current.role === 'traveler') throw new Error(t('You no longer run {name}.', { name: org.name }));
            const [members, invitations] = await Promise.all([
                ctx.api.getOrgMembers(org.id),
                current.role === 'admin' ? ctx.api.getOrgInvitations(org.id) : []
            ]);
            return { current, members, invitations };
        },
        onError: error => orgError(ctx, error),
        draw: ({ current, members, invitations }, step, close) => [
            h('h3', { id: 'org-manage-title' }, current.name),
            h('p', { class: 'small muted' }, `${t('Your role: {role}', { role: roleLabel(current.role) })} · ${tn(members.length, '{count} member', '{count} members')}`),
            reportSection(current, view, step),
            h('section', { class: 'dialog-section', 'aria-labelledby': 'org-members-title' },
                h('h4', { id: 'org-members-title' }, t('👥 Members')),
                h('ul', { class: 'dialog-list' }, members.map(member => memberItem(ctx, current, member, step)))),
            current.role === 'admin' ? invitationsSection(ctx, current, invitations, step) : null,
            rulesSection(ctx, current, step),
            checklistSection(ctx, current, step),
            current.role === 'admin' ? h('div', { class: 'dialog-buttons dialog-section' },
                h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => step(() => rename(ctx, current)) }, t('✏️ Rename')),
                h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: () => step(() => remove(ctx, current, back)) }, t('🗑️ Delete'))) : null,
            h('div', { class: 'dialog-actions' }, h('button', {
                type: 'button', class: 'btn btn-primary',
                onclick: () => {
                    close();
                    back();
                }
            }, t('Back')))
        ]
    });
}
