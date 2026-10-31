// Organizations (ADR 0022, ADR 0029), from the account menu: the traveler's organizations,
// joining with an invitation link, creating one, leaving, and who looked at their business-day
// counts. Managers and admins run theirs in org-manage.js.
import { h, toast, formDialog, formatDate, steppedDialog, STAY_CLOSED } from './ui.js';
import { invitationToken } from './org-data.js';
import { INVITATION_KEY } from './home.js';
import { manageOrg, orgError, roleLabel } from './org-manage.js';
import { t, tn } from './i18n.js';

const PENDING_KEY = INVITATION_KEY;

/**
 * Keeps the token of an opened invitation link (`/#join=<token>`) for after signing in, and
 * takes it out of the address. Whether one is waiting.
 */
export function takeInvitation() {
    const token = location.hash.startsWith('#join=') ? invitationToken(location.hash) : null;
    if (location.hash.startsWith('#join=')) history.replaceState(null, '', location.pathname + location.search);
    try {
        if (token) sessionStorage.setItem(PENDING_KEY, token);
        return Boolean(sessionStorage.getItem(PENDING_KEY));
    } catch {
        // Without storage the link cannot wait for a sign-in; it works once signed in.
        return false;
    }
}

function pendingInvitation({ remove = false } = {}) {
    try {
        const token = sessionStorage.getItem(PENDING_KEY);
        if (remove) sessionStorage.removeItem(PENDING_KEY);
        return token;
    } catch {
        return null;
    }
}

// The traveler's organizations, which the visit form and the Ledger tab read.
async function loadOrgs(ctx) {
    ctx.state.orgs = await ctx.api.getOrgs();
    ctx.renderActiveTab();
    return ctx.state.orgs;
}

/** Joins with a token once the traveler agrees; true when joined. */
async function joinWith(ctx, token) {
    const agreed = await ctx.confirmDialog({
        title: t('Join this organization?'),
        message: t('Its managers and admins will see the days you mark as business trips for it, per country, and how they stand against its rules: never your places, notes or personal trips. You can leave at any time.'),
        confirmLabel: t('Join')
    });
    if (!agreed) return false;
    const org = await ctx.api.joinOrg(token);
    toast(t('You joined {name}. Your role: {role}.', { name: org.name, role: roleLabel(org.role) }), { tone: 'success' });
    return true;
}

/** After signing in, joins with the invitation link opened before (ADR 0029). */
export async function joinPendingInvitation(ctx) {
    const token = pendingInvitation({ remove: true });
    if (!token) return;
    try {
        if (await joinWith(ctx, token)) await openOrgs(ctx);
    } catch (error) {
        ctx.handleError(error);
    }
}

/** Signed out with an invitation waiting: says what signing in is for; whether one waits. */
export function explainInvitation() {
    if (!pendingInvitation()) return false;
    toast(t('Log in or sign up to join the organization that invited you.'), { duration: 8000 });
    return true;
}

/** An invitation link opened in a tab already showing the app. */
export function setupInvitations(ctx) {
    window.addEventListener('hashchange', () => {
        if (!location.hash.startsWith('#join=') || !takeInvitation()) return;
        if (ctx.state.user && !ctx.state.user.guest) joinPendingInvitation(ctx);
        else explainInvitation();
    });
}

async function joinByLink(ctx) {
    const values = await formDialog({
        title: t('Join an organization'),
        message: t('Paste the invitation link an admin of your organization sent you.'),
        submitLabel: t('Next'),
        fields: [{ name: 'link', label: t('Invitation link'), required: true, placeholder: 'https://…/#join=…' }]
    });
    if (!values) return;
    const token = invitationToken(values.link);
    if (!token) throw new Error(t('That is not a complete invitation link.'));
    await joinWith(ctx, token);
}

async function createOrg(ctx) {
    const values = await formDialog({
        title: t('Create an organization'),
        message: t('You become its admin: invite your team, set the rules that matter to you and see business days per country. Running one needs a passkey or two-step sign-in.'),
        submitLabel: t('Create'),
        fields: [{ name: 'name', label: t('Name'), required: true, maxlength: 80, placeholder: t('Acme Corp') }]
    });
    if (!values) return null;
    const org = await ctx.api.createOrg(values.name.trim());
    toast(t('Created {name}. Invite your team from Manage.', { name: org.name }), { tone: 'success' });
    return org;
}

async function leaveOrg(ctx, org) {
    const agreed = await ctx.confirmDialog({
        title: t('Leave {name}?', { name: org.name }),
        message: t('Your business trips for it become personal again, and it no longer sees your days.'),
        confirmLabel: t('Leave'), danger: true
    });
    if (!agreed) return;
    await ctx.api.removeOrgMember(org.id, ctx.state.user.username);
    toast(t('You left {name}.', { name: org.name }));
    // Business visits for it are personal now.
    await ctx.reloadMarkers();
}

function orgItem(ctx, org, step) {
    const rules = tn(org.rules.length, '{count} rule', '{count} rules');
    return h('li', { class: 'dialog-item' },
        h('span', {}, h('strong', {}, org.name), h('small', {}, `${roleLabel(org.role)} · ${rules}`)),
        org.role === 'traveler' ? null : h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': t('Manage {name}', { name: org.name }),
            onclick: () => step(() => {
                manageOrg(ctx, org, () => openOrgs(ctx));
                return STAY_CLOSED;
            })
        }, t('Manage')),
        h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', 'aria-label': t('Leave {name}', { name: org.name }), onclick: () => step(() => leaveOrg(ctx, org)) }, t('Leave')));
}

/** The Organizations dialog, redrawn after each change. */
export function openOrgs(ctx) {
    return steppedDialog({
        labelledBy: 'orgs-title',
        load: async () => {
            const [orgs, audit] = await Promise.all([loadOrgs(ctx), ctx.api.getOrgAudit()]);
            return { orgs, audit };
        },
        onError: error => orgError(ctx, error),
        draw: ({ orgs, audit }, step, close) => [
            h('h3', { id: 'orgs-title' }, t('Organizations')),
            h('p', { class: 'small' }, t('Mark business trips for your employer and see them against its rules in the Ledger tab. Its managers see business days per country, never your places, notes or personal trips.')),
            orgs.length ? h('ul', { class: 'dialog-list' }, orgs.map(org => orgItem(ctx, org, step))) : h('p', { class: 'muted small' }, t('You are not in an organization yet.')),
            h('div', { class: 'dialog-buttons' },
                h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => step(() => joinByLink(ctx)) }, t('🔗 Join with a link')),
                h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: orgs.length >= 10, onclick: () => step(() => createOrg(ctx)) }, t('＋ Create an organization'))),
            h('section', { class: 'dialog-section', 'aria-labelledby': 'audit-title' },
                h('h4', { id: 'audit-title' }, t('👀 Who looked at your days')),
                audit.length ? h('ul', { class: 'dialog-list' }, audit.map(entry => h('li', { class: 'dialog-item' },
                    h('span', {}, h('strong', {}, entry.actor || t('A deleted account')), h('small', {}, `${entry.organization} · ${entry.action} · ${formatDate(entry.at.slice(0, 10))}`)))))
                    : h('p', { class: 'muted small' }, t('Nobody has looked at your business days yet.'))),
            h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: close }, t('Done')))
        ]
    });
}
