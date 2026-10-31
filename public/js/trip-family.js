// The trip editor's family view: a private, read-only link to the trip's stops and dates for
// family without an account (src/family-links.js). The owner makes it, sees it once, and can
// replace or end it; day plans, the packing list and the budget never show through it.
import { h, fill, toast, copyText, formatDate } from './ui.js';
import { section } from './trip-extras.js';
import { ownsTrip } from './trip-share.js';
import { t } from './i18n.js';

function draw(ctx, trip, body, link, url = '') {
    const make = async () => {
        try {
            const created = await ctx.api.createFamilyLink(trip.id);
            draw(ctx, trip, body, { active: true, createdAt: created.createdAt }, created.url);
        } catch (error) {
            ctx.handleError(error);
        }
    };
    const stop = async () => {
        if (!(await ctx.confirmDialog({ title: t('Turn off the family link?'), message: t('Whoever has it can no longer see this trip.'), confirmLabel: t('Turn off'), danger: true }))) return;
        try {
            await ctx.api.deleteFamilyLink(trip.id);
            draw(ctx, trip, body, { active: false, createdAt: null });
            toast(t('Family link turned off.'));
        } catch (error) {
            ctx.handleError(error);
        }
    };
    if (!link.active) {
        fill(body,
            h('p', { class: 'hint' }, t('A private link to this trip\'s stops and dates, so family know where you are this week without an account. Day plans, notes, the packing list and the budget stay private.')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: make }, t('👪 Make a family link')));
        return;
    }
    fill(body,
        url ? [
            h('label', { class: 'field', for: 'family-link-url' }, h('span', {}, t('Family link')),
                h('input', { id: 'family-link-url', type: 'url', value: url, readonly: true })),
            h('p', { class: 'hint' }, t('It is shown only now. Anyone with it sees this trip\'s title, stops and dates, and your username.')),
            h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => copyText(url, t('Family link copied.'), t('Family link: {link}', { link: url })) }, t('📋 Copy the link'))
        ] : h('p', { class: 'hint' }, t('On since {date}. The link was shown when it was made; make a new one to see a link again.', { date: formatDate(String(link.createdAt).slice(0, 10)) })),
        h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: make }, t('New link, ending this one')),
            h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: stop }, t('Turn off'))));
}

/** The family view section of a saved trip the traveler owns; it asks for the link's state when opened. */
export function familySection(ctx, trip) {
    if (!trip.id || !ownsTrip(trip) || ctx.state.user?.guest) return null;
    const body = h('div', { 'aria-live': 'polite' }, h('p', { class: 'hint' }, t('Loading…')));
    let loaded = false;
    const load = () => {
        if (loaded) return;
        loaded = true;
        ctx.api.getFamilyLink(trip.id).then(link => draw(ctx, trip, body, link))
            .catch(() => fill(body, h('p', { class: 'hint' }, t('The family link could not be loaded.'))));
    };
    const details = section('family', t('👪 Family view'), h('small', {}), body);
    details.addEventListener('toggle', () => { if (details.open) load(); });
    if (details.open) load();
    return details;
}
