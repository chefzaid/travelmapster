// Planning a trip together (ADR 0028): its owner shares it with other accounts to edit or only
// view, and a member can leave it.
import { h, toast } from './ui.js';

const ROLES = [['edit', 'Can edit'], ['view', 'Can view']];

/** Whether the traveler owns the trip (a guest's trips and older answers have no role). */
export const ownsTrip = trip => !trip.role || trip.role === 'owner';

/** "Shared by ana · you can edit", or null for the traveler's own trip. */
export function sharedNote(trip) {
    if (ownsTrip(trip)) return null;
    return h('p', { class: 'trip-shared' }, h('span', { 'aria-hidden': 'true' }, '👥 '),
        `Shared by ${trip.owner} · you can ${trip.role === 'edit' ? 'edit it' : 'view it'}`);
}

function roleSelect(value, label, onchange) {
    return h('select', { 'aria-label': label, onchange },
        ROLES.map(([role, text]) => h('option', { value: role, selected: role === value }, text)));
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
                type: 'button', class: 'icon-btn', 'aria-label': `Stop sharing with ${member.username}`, title: 'Remove',
                onclick: () => run(async () => {
                    await ctx.api.unshareTrip(trip.id, member.username);
                    return ctx.api.getTripMembers(trip.id);
                })
            }, '✕'))) : [h('li', { class: 'muted small' }, 'Not shared with anyone yet.')]));
    }
    const name = h('input', { name: 'username', maxlength: 32, autocomplete: 'off', placeholder: 'Their username', 'aria-label': 'Username to share with', required: true });
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
                toast(`Shared with ${username}.`, { tone: 'success' });
                return members;
            });
        }
    }, name, role, h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Share'));
    dialog.append(h('div', { class: 'dialog-body' },
        h('h3', { id: 'share-title' }, `Plan “${trip.title}” together`),
        h('p', { class: 'small' }, 'People you add see this trip in their Trips tab. Editors change its days, stops, packing list and budget; only you share or delete it.'),
        list, add, error,
        h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dialog.close() }, 'Done'))));
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
            if (dirty()) toast('Save your changes before sharing the trip.', { tone: 'error' });
            else openSharing(ctx, trip);
        }
    }, '👥 Share');
}

/** A member leaves a trip shared with them; resolves to whether they did. */
export async function leaveTrip(ctx, trip) {
    if (!(await ctx.confirmDialog({ title: `Leave “${trip.title}”?`, message: `${trip.owner} can share it with you again.`, confirmLabel: 'Leave trip', danger: true }))) return false;
    try {
        await ctx.api.unshareTrip(trip.id, ctx.state.user.username);
        toast('You left the trip.');
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}
