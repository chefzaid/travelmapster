// The visits on a place's map card: each stay with its dates, notes and photo link, and the
// dialogs that add, edit and remove them, with undo. Dates are checked in visits.js.
import { h, toast, formDialog, formatDate } from './ui.js';
import { checkVisit, formatVisitDates, sortVisits, lastVisitDate, visitCountLabel, visitDays } from './visits.js';
import { statusOf } from './status.js';
import { purposeValue, readPurpose } from './org-data.js';
import { readCompanions } from './companions.js';
import { formatList, joinList, t, tn } from './i18n.js';

function setVisits(ctx, marker, visits, reopenCard) {
    marker.visits = sortVisits(visits);
    marker.travelDate = lastVisitDate(marker);
    ctx.refresh();
    reopenCard();
}

// A member of an organization says whether a visit was a business trip for it (ADR 0029);
// without one, the form leaves the purpose alone.
function purposeFields(ctx, draft) {
    const orgs = ctx.state.orgs || [];
    if (!orgs.length) return [];
    return [{
        name: 'purpose', label: t('Trip for'), type: 'select', value: purposeValue(draft),
        options: [{ value: 'personal', label: t('Personal') }, ...orgs.map(org => ({ value: `business:${org.id}`, label: t('Business: {name}', { name: org.name }) }))],
        hint: t('Its managers see business days per country, never this place or its notes.')
    }];
}

// Asks for a visit's dates and details; a mistake reopens the form with what was typed.
async function visitDialog(ctx, marker, visit) {
    let draft = visit;
    for (;;) {
        const values = await formDialog({
            title: visit ? t('Edit visit to {name}', { name: marker.name }) : t('Add a visit to {name}', { name: marker.name }),
            submitLabel: visit ? t('Save visit') : t('Add visit'),
            fields: [
                { name: 'startDate', label: t('First day'), type: 'date', value: draft?.startDate || '', required: true },
                { name: 'endDate', label: t('Last day'), type: 'date', value: draft?.endDate || '', hint: t('Optional. Without it, the day ledger counts the first day only.') },
                { name: 'ongoing', label: t('I\'m still there'), type: 'checkbox', value: draft?.ongoing, hint: t('Leave the last day empty: the day ledger counts every day up to today.') },
                { name: 'companions', label: t('Who came along'), value: joinList(readCompanions(draft?.companions)), placeholder: t('Sam, Alex'), autocomplete: 'off', hint: t('Names only, between commas. Filter the map by who you traveled with in Places.') },
                { name: 'notes', label: t('What happened'), type: 'textarea', value: draft?.notes || '', maxlength: 2000, placeholder: t('Favorite memory, what you ate…') },
                { name: 'photoUrl', label: t('Photo link'), type: 'url', value: draft?.photoUrl || '', placeholder: 'https://…', hint: t('Link to a photo or album hosted anywhere (HTTP or HTTPS).') },
                ...purposeFields(ctx, draft)
            ]
        });
        if (!values) return null;
        const purpose = values.purpose === undefined ? {} : readPurpose(values.purpose);
        const { visit: checked, error } = checkVisit(values);
        if (!error) return { ...checked, ...purpose };
        toast(error, { tone: 'error' });
        draft = { ...values, ...purpose };
    }
}

async function addVisit(ctx, marker, reopenCard) {
    const values = await visitDialog(ctx, marker);
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
    const values = await visitDialog(ctx, marker, visit);
    if (!values) return;
    try {
        const updated = await ctx.api.updateVisit(visit.id, values);
        setVisits(ctx, marker, marker.visits.map(item => (item.id === visit.id ? updated : item)), reopenCard);
        toast(t('Visit saved.'), { tone: 'success' });
    } catch (error) {
        ctx.handleError(error);
    }
}

async function removeVisit(ctx, marker, visit, reopenCard) {
    try {
        await ctx.api.deleteVisit(visit.id);
        setVisits(ctx, marker, marker.visits.filter(item => item.id !== visit.id), reopenCard);
        toast(t('Removed the visit of {startDate}.', { startDate: formatDate(visit.startDate) }), {
            action: {
                label: t('Undo'),
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
    const business = visit.purpose === 'business' ? (ctx.state.orgs || []).find(org => org.id === visit.organizationId) || {} : null;
    return h('li', { class: 'visit' },
        h('div', { class: 'visit-text' },
            h('strong', {}, h('span', { 'aria-hidden': 'true' }, '📅 '), dates),
            days ? h('small', { class: 'visit-days' }, tn(days, '{count} day', '{count} days')) : null,
            !visit.endDate && !visit.ongoing ? h('small', { class: 'visit-days' }, t('Last day not recorded')) : null,
            business ? h('small', { class: 'visit-days' }, business.name ? t('💼 Business: {name}', { name: business.name }) : t('💼 Business')) : null,
            visit.companions?.length ? h('small', { class: 'visit-days visit-companions' }, t('👥 With {names}', { names: formatList(visit.companions) })) : null,
            visit.notes ? h('p', { class: 'visit-notes' }, visit.notes) : null,
            visit.photoUrl ? h('a', { href: visit.photoUrl, target: '_blank', rel: 'noopener noreferrer', class: 'visit-photo', 'aria-label': t('Photo of the visit of {dates} (opens in a new tab)', { dates }) }, t('📷 Photo')) : null
        ),
        ctx.state.user ? h('div', { class: 'visit-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Edit the visit of {dates}', { dates }), title: t('Edit visit'), onclick: () => editVisit(ctx, marker, visit, reopenCard) }, '✏️'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove the visit of {dates}', { dates }), title: t('Remove visit'), onclick: () => removeVisit(ctx, marker, visit, reopenCard) }, '🗑️')
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
            ADD_VISIT_LABELS[status] || t('＋ Add a visit')) : null
    );
}
