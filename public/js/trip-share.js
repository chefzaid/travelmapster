// Planning a trip together (ADR 0028): its owner shares it with other accounts to edit or only
// view, and a member can leave it.
import { h, toast } from './ui.js';
import { t, tk } from './i18n.js';

const ROLES = [['edit', tk('Can edit')], ['view', tk('Can view')]];

/** Whether the traveler owns the trip (a guest's trips and older answers have no role). */
export const ownsTrip = trip => !trip.role || trip.role === 'owner';

/** "Shared by ana · you can edit", or null for the traveler's own trip. */
export function sharedNote(trip) {
    if (ownsTrip(trip)) return null;
    return h('p', { class: 'trip-shared' }, h('span', { 'aria-hidden': 'true' }, '👥 '),
        trip.role === 'edit' ? t('Shared by {owner} · you can edit it', { owner: trip.owner }) : t('Shared by {owner} · you can view it', { owner: trip.owner }));
}

function roleSelect(value, label, onchange) {
    return h('select', { 'aria-label': label, onchange },
        ROLES.map(([role, text]) => h('option', { value: role, selected: role === value }, t(text))));
}

/** The dialog that lists who a trip is shared with, to add people, change roles or remove them. */
async function openSharing(ctx, trip) {
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'share-title' });
    const list = h('ul', { class: 'member-list' });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const show = message => {
        error.textContent = message;
        error.hidden = !message;
    };
    const run = async action => {
        show('');
        try {
            draw(await action());
        } catch (failure) {
            show(failure.message);
        }
    };
    function draw(members) {
        list.replaceChildren(...(members.length ? members.map(member => h('li', { class: 'member' },
            h('strong', {}, member.username),
            roleSelect(member.role, `${member.username}'s role`, event => run(() => ctx.api.shareTrip(trip.id, member.username, event.target.value))),
            h('button', {
                type: 'button', class: 'icon-btn', 'aria-label': t('Stop sharing with {username}', { username: member.username }), title: t('Remove'),
                onclick: () => run(async () => {
                    await ctx.api.unshareTrip(trip.id, member.username);
                    return ctx.api.getTripMembers(trip.id);
                })
            }, '✕'))) : [h('li', { class: 'muted small' }, t('Not shared with anyone yet.'))]));
    }
    const name = h('input', { name: 'username', maxlength: 32, autocomplete: 'off', placeholder: t('Their username'), 'aria-label': t('Username to share with'), required: true });
    const role = roleSelect('edit', 'Role', () => {});
    const add = h('form', {
        class: 'row share-add',
        onsubmit: event => {
            event.preventDefault();
            const username = name.value.trim();
            if (!username) return;
            run(async () => {
                const members = await ctx.api.shareTrip(trip.id, username, role.value);
                name.value = '';
                toast(t('Shared with {username}.', { username }), { tone: 'success' });
                return members;
            });
        }
    }, name, role, h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, t('Share')));
    dialog.append(h('div', { class: 'dialog-body' },
        h('h3', { id: 'share-title' }, t('Plan “{title}” together', { title: trip.title })),
        h('p', { class: 'small' }, t('People you add see this trip in their Trips tab. Editors change its days, stops, packing list and budget; only you share or delete it.')),
        list, add, error,
        h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dialog.close() }, t('Done')))));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    await run(() => ctx.api.getTripMembers(trip.id));
}

/** The owner's button to share a trip; none for guests, who have no account to share from. */
export function shareButton(ctx, trip, dirty) {
    if (!ownsTrip(trip) || ctx.state.user.guest) return null;
    return h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: () => {
            if (dirty()) toast(t('Save your changes before sharing the trip.'), { tone: 'error' });
            else openSharing(ctx, trip);
        }
    }, t('👥 Share'));
}

/** A member leaves a trip shared with them; resolves to whether they did. */
export async function leaveTrip(ctx, trip) {
    if (!(await ctx.confirmDialog({ title: t('Leave “{title}”?', { title: trip.title }), message: t('{owner} can share it with you again.', { owner: trip.owner }), confirmLabel: t('Leave trip'), danger: true }))) return false;
    try {
        await ctx.api.unshareTrip(trip.id, ctx.state.user.username);
        toast(t('You left the trip.'));
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}
