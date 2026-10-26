// The visits on a place's map card: each stay with its dates, notes and photo link, and the
// dialogs that add, edit and remove them, with undo. Dates are checked in visits.js.
import { h, toast, formDialog, formatDate } from './ui.js';
import { checkVisit, formatVisitDates, sortVisits, lastVisitDate, visitCountLabel, visitDays } from './visits.js';
import { statusOf } from './status.js';

function setVisits(ctx, marker, visits, reopenCard) {
    marker.visits = sortVisits(visits);
    marker.travelDate = lastVisitDate(marker);
    ctx.refresh();
    reopenCard();
}

// Asks for a visit's dates and details; a mistake reopens the form with what was typed.
async function visitDialog(marker, visit) {
    let draft = visit;
    for (;;) {
        const values = await formDialog({
            title: visit ? `Edit visit to ${marker.name}` : `Add a visit to ${marker.name}`,
            submitLabel: visit ? 'Save visit' : 'Add visit',
            fields: [
                { name: 'startDate', label: 'First day', type: 'date', value: draft?.startDate || '', required: true },
                { name: 'endDate', label: 'Last day', type: 'date', value: draft?.endDate || '', hint: 'Optional. Without it, the day ledger counts the first day only.' },
                { name: 'ongoing', label: 'I\'m still there', type: 'checkbox', value: draft?.ongoing, hint: 'Leave the last day empty: the day ledger counts every day up to today.' },
                { name: 'notes', label: 'What happened', type: 'textarea', value: draft?.notes || '', maxlength: 2000, placeholder: 'Favorite memory, who you went with…' },
                { name: 'photoUrl', label: 'Photo link', type: 'url', value: draft?.photoUrl || '', placeholder: 'https://…', hint: 'Link to a photo or album hosted anywhere (HTTP or HTTPS).' }
            ]
        });
        if (!values) return null;
        const { visit: checked, error } = checkVisit(values);
        if (!error) return checked;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

async function addVisit(ctx, marker, reopenCard) {
    const values = await visitDialog(marker);
    if (!values) return;
    try {
        const visit = await ctx.api.addVisit(marker.id, values);
        setVisits(ctx, marker, [...marker.visits, visit], reopenCard);
        toast(`${visitCountLabel(marker.visits.length, statusOf(marker))}: ${marker.name}!`, { tone: 'success' });
    } catch (error) {
        ctx.handleError(error);
    }
}

async function editVisit(ctx, marker, visit, reopenCard) {
    const values = await visitDialog(marker, visit);
    if (!values) return;
    try {
        const updated = await ctx.api.updateVisit(visit.id, values);
        setVisits(ctx, marker, marker.visits.map(item => (item.id === visit.id ? updated : item)), reopenCard);
        toast('Visit saved.', { tone: 'success' });
    } catch (error) {
        ctx.handleError(error);
    }
}

async function removeVisit(ctx, marker, visit, reopenCard) {
    try {
        await ctx.api.deleteVisit(visit.id);
        setVisits(ctx, marker, marker.visits.filter(item => item.id !== visit.id), reopenCard);
        toast(`Removed the visit of ${formatDate(visit.startDate)}.`, {
            action: {
                label: 'Undo',
                run: () => {
                    const { id, ...restored } = visit;
                    ctx.api.addVisit(marker.id, restored)
                        .then(added => setVisits(ctx, marker, [...marker.visits, added], reopenCard))
                        .catch(ctx.handleError);
                }
            }
        });
    } catch (error) {
        ctx.handleError(error);
    }
}

function visitItem(ctx, marker, visit, reopenCard) {
    const days = visitDays(visit);
    const dates = formatVisitDates(visit, formatDate);
    return h('li', { class: 'visit' },
        h('div', { class: 'visit-text' },
            h('strong', {}, h('span', { 'aria-hidden': 'true' }, '📅 '), dates),
            days ? h('small', { class: 'visit-days' }, days === 1 ? '1 day' : `${days} days`) : null,
            !visit.endDate && !visit.ongoing ? h('small', { class: 'visit-days' }, 'Last day not recorded') : null,
            visit.notes ? h('p', { class: 'visit-notes' }, visit.notes) : null,
            visit.photoUrl ? h('a', { href: visit.photoUrl, target: '_blank', rel: 'noopener noreferrer', class: 'visit-photo', 'aria-label': `Photo of the visit of ${dates} (opens in a new tab)` }, '📷 Photo') : null
        ),
        ctx.state.user ? h('div', { class: 'visit-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit the visit of ${dates}`, title: 'Edit visit', onclick: () => editVisit(ctx, marker, visit, reopenCard) }, '✏️'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove the visit of ${dates}`, title: 'Remove visit', onclick: () => removeVisit(ctx, marker, visit, reopenCard) }, '🗑️')
        ) : null
    );
}

const ADD_VISIT_LABELS = { lived: '＋ Add the dates you lived here', transit: '＋ Add a layover' };

// Visits newest first, with how many times you have been; wishlist places show them only once
// they have one. Dates where the traveler lived or changed planes are visits too, so the day
// ledger counts them (ADR 0014). A change redraws the card through reopenCard.
export function visitsSection(ctx, marker, reopenCard) {
    const visits = sortVisits(marker.visits);
    const status = statusOf(marker);
    if (status === 'wishlist' && !visits.length) return null;
    const headingId = `visits-heading-${marker.id}`;
    return h('section', { class: 'card-visits', 'aria-labelledby': headingId },
        h('h4', { id: headingId, class: 'visits-title' }, visitCountLabel(visits.length, status)),
        visits.length ? h('ol', { class: 'visit-list' }, visits.map(visit => visitItem(ctx, marker, visit, reopenCard))) : null,
        ctx.state.user ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost visit-add', onclick: () => addVisit(ctx, marker, reopenCard) },
            ADD_VISIT_LABELS[status] || '＋ Add a visit') : null
    );
}
