import { h, fill, toast, formDialog, formatDate } from './ui.js';
import { fetchIdeas, buildItinerary } from './ideas.js';

const SLOTS = [
    ['morning', '🌅', 'Morning'],
    ['afternoon', '☀️', 'Afternoon'],
    ['evening', '🌙', 'Evening']
];
const MAX_DAYS = 30;

let openTripId = null;
let draft = null;

function emptyDay() {
    return { morning: '', afternoon: '', evening: '' };
}

function dayDate(startDate, offset) {
    if (!startDate) return '';
    const [year, month, day] = startDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function endDate(trip) {
    if (!trip.startDate) return '';
    const [year, month, day] = trip.startDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + trip.plan.length - 1)).toISOString().slice(0, 10);
}

async function ideasPlan(destination, days) {
    try {
        const ideas = await Promise.race([
            fetchIdeas(destination),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
        ]);
        return buildItinerary(ideas, days);
    } catch {
        return Array.from({ length: days }, emptyDay);
    }
}

export async function openNewTrip(ctx, destination = '') {
    const values = await formDialog({
        title: '🗓️ Plan a new trip',
        submitLabel: 'Create trip',
        fields: [
            { name: 'destination', label: 'Where to?', value: destination, required: true, maxlength: 160, placeholder: 'Lisbon, Japan, Patagonia…' },
            { name: 'title', label: 'Trip name', value: destination ? `Adventure in ${destination}` : '', maxlength: 120, placeholder: 'Summer in Portugal' },
            { name: 'startDate', label: 'Start date', type: 'date' },
            { name: 'days', label: 'How many days?', type: 'number', value: 3, min: 1, max: MAX_DAYS, required: true }
        ]
    });
    if (!values) return;

    const place = values.destination.trim();
    const days = Math.min(MAX_DAYS, Math.max(1, Number.parseInt(values.days, 10) || 3));
    if (!place) {
        toast('Tell us where you are going first.', { tone: 'error' });
        return;
    }
    const closeToast = toast('Sketching your itinerary with guide ideas…', { duration: 8000 });
    try {
        const plan = await ideasPlan(place, days);
        const trip = await ctx.api.createTrip({
            title: values.title.trim() || `Adventure in ${place}`,
            destination: place,
            startDate: values.startDate,
            plan
        });
        ctx.state.trips.unshift(trip);
        openTripId = trip.id;
        draft = null;
        closeToast();
        toast(`Trip created: ${trip.title} ✈️`, { tone: 'success' });
        ctx.selectTab('trips');
        ctx.refresh();
    } catch (error) {
        closeToast();
        ctx.handleError(error);
    }
}

function tripCard(trip, ctx, container) {
    const country = ctx.state.index.findByName(trip.destination);
    const filled = trip.plan.reduce((sum, day) => sum + SLOTS.filter(([slot]) => day[slot]).length, 0);
    return h('li', {},
        h('button', {
            type: 'button',
            class: 'trip-card',
            onclick: () => {
                openTripId = trip.id;
                draft = null;
                renderTrips(container, ctx);
            }
        },
            h('span', { class: 'trip-flag', 'aria-hidden': 'true' }, country?.flag || '✈️'),
            h('span', { class: 'trip-text' },
                h('strong', {}, trip.title),
                h('small', {}, `${trip.destination} · ${trip.plan.length} ${trip.plan.length === 1 ? 'day' : 'days'}`,
                    trip.startDate ? ` · ${formatDate(trip.startDate)}` : ''),
                h('span', { class: 'progress', 'aria-label': `${filled} of ${trip.plan.length * 3} slots planned` },
                    h('span', { style: `width:${Math.round((filled / (trip.plan.length * 3)) * 100)}%` }))
            ),
            h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›')
        )
    );
}

function renderList(container, ctx) {
    const { trips } = ctx.state;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = trips.filter(trip => !trip.startDate || endDate(trip) >= today);
    const past = trips.filter(trip => trip.startDate && endDate(trip) < today);
    const section = (title, items) => items.length ? h('section', {},
        h('h3', { class: 'section-title' }, title, h('span', { class: 'count' }, items.length)),
        h('ul', { class: 'trip-list' }, items.map(trip => tripCard(trip, ctx, container)))
    ) : null;

    fill(container,
        h('div', { class: 'section-head' },
            h('h2', {}, 'Trips'),
            h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openNewTrip(ctx) }, '＋ New trip')
        ),
        trips.length ? null : h('div', { class: 'empty' },
            h('p', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🗺️'),
            h('p', {}, 'Plan day-by-day itineraries with morning, afternoon and evening ideas from travel guides.'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openNewTrip(ctx) }, 'Plan my first trip')
        ),
        section('Upcoming & someday', upcoming),
        section('Past trips', past)
    );
}

function tripAsText(trip) {
    const lines = [`${trip.title} (${trip.destination})`, ''];
    trip.plan.forEach((day, i) => {
        const date = dayDate(trip.startDate, i);
        lines.push(`Day ${i + 1}${date ? `, ${date}` : ''}`);
        for (const [slot, , label] of SLOTS) {
            if (day[slot]) lines.push(`  ${label}: ${day[slot]}`);
        }
        lines.push('');
    });
    return lines.join('\n').trim();
}

function renderEditor(container, ctx, trip) {
    if (!draft || draft.id !== trip.id) {
        draft = structuredClone(trip);
    }
    const dirty = () => JSON.stringify(draft) !== JSON.stringify(trip);
    const rerender = () => renderEditor(container, ctx, trip);
    const saveButton = h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: !dirty() }, '💾 Save');
    const markDirty = () => { saveButton.disabled = !dirty(); };

    const save = async () => {
        saveButton.disabled = true;
        try {
            const saved = await ctx.api.updateTrip(trip.id, draft);
            Object.assign(trip, saved);
            draft = structuredClone(trip);
            toast('Trip saved.', { tone: 'success' });
            rerender();
        } catch (error) {
            ctx.handleError(error);
            markDirty();
        }
    };
    saveButton.addEventListener('click', save);

    const fillIdeas = async event => {
        event.target.disabled = true;
        event.target.textContent = '✨ Thinking…';
        const plan = await ideasPlan(draft.destination, draft.plan.length);
        let added = 0;
        draft.plan.forEach((day, i) => {
            for (const [slot] of SLOTS) {
                if (!day[slot] && plan[i][slot]) {
                    day[slot] = plan[i][slot];
                    added += 1;
                }
            }
        });
        toast(added ? `Added ${added} ideas. Save to keep them.` : 'No new ideas found for the empty slots.');
        rerender();
    };

    const days = draft.plan.map((day, i) => h('section', { class: 'day-card' },
        h('header', {},
            h('h3', {}, `Day ${i + 1}`),
            draft.startDate ? h('small', {}, dayDate(draft.startDate, i)) : null,
            draft.plan.length > 1 ? h('button', {
                type: 'button',
                class: 'icon-btn',
                'aria-label': `Remove day ${i + 1}`,
                title: 'Remove day',
                onclick: () => {
                    draft.plan.splice(i, 1);
                    rerender();
                }
            }, '✕') : null
        ),
        SLOTS.map(([slot, icon, label]) => h('label', { class: 'slot' },
            h('span', {}, h('span', { 'aria-hidden': 'true' }, icon), ` ${label}`),
            h('textarea', {
                rows: 2,
                maxlength: 500,
                placeholder: `${label} plans…`,
                oninput: event => {
                    day[slot] = event.target.value;
                    markDirty();
                }
            }, day[slot])
        ))
    ));

    fill(container,
        h('div', { class: 'section-head' },
            h('button', {
                type: 'button',
                class: 'btn btn-ghost btn-sm',
                onclick: async () => {
                    if (dirty() && !(await ctx.confirmDialog({ title: 'Discard changes?', message: 'You have unsaved changes to this trip.', confirmLabel: 'Discard', danger: true }))) return;
                    openTripId = null;
                    draft = null;
                    renderTrips(container, ctx);
                }
            }, '‹ All trips'),
            saveButton
        ),
        h('div', { class: 'trip-meta' },
            h('label', { class: 'field' }, h('span', {}, 'Trip name'),
                h('input', { value: draft.title, maxlength: 120, oninput: event => { draft.title = event.target.value; markDirty(); } })),
            h('div', { class: 'row' },
                h('label', { class: 'field' }, h('span', {}, 'Destination'),
                    h('input', { value: draft.destination, maxlength: 160, oninput: event => { draft.destination = event.target.value; markDirty(); } })),
                h('label', { class: 'field' }, h('span', {}, 'Start date'),
                    h('input', { type: 'date', value: draft.startDate, onchange: event => { draft.startDate = event.target.value; rerender(); } }))
            )
        ),
        h('div', { class: 'row trip-tools' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: fillIdeas }, '✨ Fill empty slots'),
            h('button', {
                type: 'button',
                class: 'btn btn-ghost btn-sm',
                onclick: async () => {
                    try {
                        await navigator.clipboard.writeText(tripAsText(draft));
                        toast('Itinerary copied to your clipboard.', { tone: 'success' });
                    } catch {
                        toast('Copying is not available in this browser.', { tone: 'error' });
                    }
                }
            }, '📋 Copy'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => ctx.showIdeas(draft.destination) }, '💡 Ideas')
        ),
        h('div', { class: 'days' }, days),
        h('div', { class: 'row trip-footer' },
            h('button', {
                type: 'button',
                class: 'btn btn-ghost btn-sm',
                disabled: draft.plan.length >= MAX_DAYS,
                onclick: () => {
                    draft.plan.push(emptyDay());
                    rerender();
                }
            }, '＋ Add a day'),
            h('button', {
                type: 'button',
                class: 'btn btn-danger-ghost btn-sm',
                onclick: async () => {
                    if (!(await ctx.confirmDialog({ title: `Delete “${trip.title}”?`, message: 'This itinerary will be gone for good.', confirmLabel: 'Delete trip', danger: true }))) return;
                    try {
                        await ctx.api.deleteTrip(trip.id);
                        ctx.state.trips = ctx.state.trips.filter(item => item.id !== trip.id);
                        openTripId = null;
                        draft = null;
                        toast('Trip deleted.');
                        ctx.refresh();
                    } catch (error) {
                        ctx.handleError(error);
                    }
                }
            }, '🗑️ Delete trip')
        )
    );
}

export function renderTrips(container, ctx) {
    const trip = ctx.state.trips.find(item => item.id === openTripId);
    if (trip) renderEditor(container, ctx, trip);
    else renderList(container, ctx);
}
