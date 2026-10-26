// The trip editor's day cards: each day's morning, afternoon and evening plans, its date and
// stop, with days reordered by dragging or with the arrow buttons, and plans dragged from one
// slot to another (they swap).
import { h } from './ui.js';
import { SLOTS, dayDate, stopOfDay } from './itinerary.js';
import { moveDay, removeTripDay, swapSlots } from './trip-stops.js';
import { t } from './i18n.js';

const DAY_TYPE = 'application/x-travelmapster-day';
const SLOT_TYPE = 'application/x-travelmapster-slot';

// Accepts a drop of one of our own drags (text dragged in from elsewhere keeps its default).
function dropZone(type, onDrop) {
    const carries = event => event.dataTransfer?.types.includes(type);
    return {
        ondragover: event => {
            if (!carries(event)) return;
            event.preventDefault();
            event.currentTarget.classList.add('drop-target');
        },
        ondragleave: event => event.currentTarget.classList.remove('drop-target'),
        ondrop: event => {
            if (!carries(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.classList.remove('drop-target');
            onDrop(event.dataTransfer.getData(type));
        }
    };
}

/**
 * The day cards of a trip's draft. `showStop(day)` shows the day's stop on the map; the other
 * hooks redraw the editor and mark the draft as changed.
 */
export function dayCards(draft, { rerender, markDirty, showStop, readOnly = false }) {
    const move = (from, to) => {
        if (moveDay(draft, from, to)) rerender();
    };
    const last = draft.plan.length - 1;
    return draft.plan.map((day, i) => h('section', {
        class: 'day-card',
        ...(readOnly ? {} : dropZone(DAY_TYPE, from => move(Number(from), i)))
    },
        h('header', {},
            readOnly ? null : h('span', {
                class: 'drag-handle', draggable: 'true', title: t('Drag to move this day'), 'aria-hidden': 'true',
                ondragstart: event => {
                    event.dataTransfer.setData(DAY_TYPE, String(i));
                    event.dataTransfer.effectAllowed = 'move';
                }
            }, '⠿'),
            h('h3', {}, t('Day {number}', { number: i + 1 })),
            draft.startDate ? h('small', {}, dayDate(draft.startDate, i)) : null,
            h('button', { type: 'button', class: 'day-stop', title: t('Show on the map'), onclick: () => showStop(i) },
                `📍 ${stopOfDay(draft, i).destination || t('New stop')}`),
            h('span', { class: 'day-actions' },
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Move day {number} earlier', { number: i + 1 }), title: t('Earlier'), disabled: i === 0, onclick: () => move(i, i - 1) }, '↑'),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Move day {number} later', { number: i + 1 }), title: t('Later'), disabled: i === last, onclick: () => move(i, i + 1) }, '↓'),
                last > 0 ? h('button', {
                    type: 'button', class: 'icon-btn', 'aria-label': t('Remove day {number}', { number: i + 1 }), title: t('Remove day'),
                    onclick: () => {
                        removeTripDay(draft, i);
                        rerender();
                    }
                }, '✕') : null)
        ),
        SLOTS.map(([slot, icon, label]) => h('label', {
            class: 'slot',
            ...(readOnly ? {} : dropZone(SLOT_TYPE, from => {
                if (swapSlots(draft, JSON.parse(from), { day: i, slot })) rerender();
            }))
        },
            h('span', {
                draggable: readOnly ? false : 'true', title: readOnly ? undefined : t('Drag onto another slot to swap their plans'),
                ondragstart: event => {
                    event.dataTransfer.setData(SLOT_TYPE, JSON.stringify({ day: i, slot }));
                    event.dataTransfer.effectAllowed = 'move';
                }
            }, h('span', { 'aria-hidden': 'true' }, icon), ` ${t(label)}`),
            h('textarea', {
                rows: 2,
                maxlength: 500,
                placeholder: t('{slot} plans…', { slot: t(label) }),
                oninput: event => {
                    day[slot] = event.target.value;
                    markDirty();
                }
            }, day[slot])
        ))
    ));
}
