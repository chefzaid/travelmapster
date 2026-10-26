// Business trips and their pre-trip checklist (ADR 0030): the owner says which organization a
// trip is for, and the editor lists what that organization asks before going to its countries,
// added to the packing list to tick off.
import { h, toast, formatDate } from './ui.js';
import { tripChecklist, withChecklistItems } from './org-data.js';
import { tripStops } from './itinerary.js';
import { destinationPlace } from './trip-visits.js';
import { ownsTrip } from './trip-share.js';
import { localToday } from './days.js';
import { section } from './trip-extras.js';

const STATE_LABELS = { done: 'Done', listed: 'On your packing list', missing: 'Not on your list yet' };

/** The checklist of a trip, from its countries and the traveler's organizations. */
export function checklistOf(ctx, trip) {
    const countryIds = tripStops(trip).map(stop => destinationPlace(ctx, stop.destination)?.countryId).filter(Boolean);
    return tripChecklist({ trip, orgs: ctx.state.orgs || [], countryIds, today: localToday() });
}

/** Whom a trip is for: personal, or business for one of the owner's organizations. */
export function purposeField(ctx, draft, trip, rerender) {
    const orgs = ctx.state.orgs || [];
    if (!ownsTrip(trip) || !orgs.length) return null;
    return h('label', { class: 'field' }, h('span', {}, 'Trip for'),
        h('select', {
            onchange: event => {
                draft.organizationId = event.target.value ? Number(event.target.value) : null;
                rerender();
            }
        },
            h('option', { value: '', selected: !draft.organizationId }, 'Personal'),
            orgs.map(org => h('option', { value: org.id, selected: draft.organizationId === org.id }, `Business: ${org.name}`))));
}

function itemLine({ item, state, due, overdue }) {
    return h('li', { class: `checklist-item is-${state}` },
        h('span', { 'aria-hidden': 'true' }, state === 'done' ? '✅' : overdue ? '⏰' : '⬜'),
        h('span', {},
            h('strong', {}, item.task),
            h('small', {}, [STATE_LABELS[state], due ? `${overdue ? 'overdue since' : 'due'} ${formatDate(due)}` : null].filter(Boolean).join(' · ')),
            item.link ? h('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `About ${item.task} (opens in a new tab)` }, 'How to') : null));
}

/** What the trip's organization asks before going, with a button that lists it to pack. */
export function checklistSection(ctx, draft, { rerender, readOnly }) {
    const checklist = checklistOf(ctx, draft);
    if (!checklist) return null;
    const done = checklist.items.filter(entry => entry.state === 'done').length;
    const missing = checklist.items.some(entry => entry.state === 'missing');
    return section('checklist', `🏢 Before you go: ${checklist.org.name}`, h('small', {}, `${done} of ${checklist.items.length} done`),
        h('p', { class: 'hint' }, 'Your organization asks for these before a business trip to these countries. Tick them off on your packing list.'),
        h('ul', { class: 'checklist' }, checklist.items.map(itemLine)),
        missing && !readOnly ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => {
                draft.packing = withChecklistItems(draft.packing || [], checklist.items);
                toast('Added to your packing list. Save to keep them.');
                rerender();
            }
        }, '＋ Add to packing list') : null);
}

/** How many of an upcoming business trip's tasks are not done yet, for the trips list. */
export function checklistBadge(ctx, trip) {
    if (!trip.startDate || trip.startDate < localToday()) return null;
    const left = checklistOf(ctx, trip)?.items.filter(entry => entry.state !== 'done') || [];
    if (!left.length) return null;
    return h('small', { class: `checklist-badge${left.some(entry => entry.overdue) ? ' is-overdue' : ''}` },
        `📋 ${left.length} to do before you go`);
}
