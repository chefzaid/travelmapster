// Trips tab: day-by-day itineraries to one destination or several, with ideas from Wikivoyage,
// copied as text, exported to a calendar, printed, duplicated as a template, or planned in the
// day ledger; with a packing list and a budget.
import { h, fill, toast, formDialog, formatDate, downloadFile } from './ui.js';
import { fetchIdeas, buildItinerary } from './ideas.js';
import {
    SLOTS, dayDate, emptyDay, isTripPlan, stopOfDay, syncPlannedStays, tripAsText, tripCalendar, tripEndDate, tripFileName,
    tripPlannedStays, tripRoute, tripStops, tripTemplate
} from './itinerary.js';
import { completeTrip, destinationPlace, tripRecorded } from './trip-visits.js';
import { addTripDay } from './trip-stops.js';
import { dayCards } from './trip-days.js';
import { leaveTrip, ownsTrip, shareButton, sharedNote } from './trip-share.js';
import { localToday } from './days.js';
import { openPrintView, printTable } from './print-view.js';
import { budgetSection, packingSection, stopsSection } from './trip-extras.js';
import { budgetTotals, formatMoney, tidyBudget } from './trip-budget.js';

const MAX_DAYS = 30;

let openTripId = null;
let draft = null;

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
    const country = ctx.state.index.byId.get(destinationPlace(ctx, trip.destination)?.countryId);
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
                h('small', {}, `${tripRoute(trip)} · ${trip.plan.length} ${trip.plan.length === 1 ? 'day' : 'days'}`,
                    trip.startDate ? ` · ${formatDate(trip.startDate)}` : '', trip.owner ? ` · 👥 ${trip.owner}` : ''),
                h('span', { class: 'progress', 'aria-label': `${filled} of ${trip.plan.length * 3} slots planned` },
                    h('span', { style: `width:${Math.round((filled / (trip.plan.length * 3)) * 100)}%` }))
            ),
            h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›')
        )
    );
}

function renderList(container, ctx) {
    const { trips } = ctx.state;
    const today = localToday();
    const upcoming = trips.filter(trip => !trip.startDate || tripEndDate(trip) >= today);
    const past = trips.filter(trip => trip.startDate && tripEndDate(trip) < today);
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

// The itinerary as a page to print or save as PDF, one row per day.
function printTrip(trip, opener) {
    openPrintView({
        eyebrow: 'TravelMapster itinerary',
        title: trip.title,
        opener,
        content: [
            h('dl', { class: 'report-facts' },
                h('dt', {}, trip.stops?.length ? 'Route' : 'Destination'), h('dd', {}, tripRoute(trip)),
                h('dt', {}, 'When'), h('dd', {}, trip.startDate
                    ? `${formatDate(trip.startDate)} – ${formatDate(tripEndDate(trip))}`
                    : `${trip.plan.length} ${trip.plan.length === 1 ? 'day' : 'days'}, dates to choose`)
            ),
            printTable(['Day', ...SLOTS.map(([, , label]) => label)], trip.plan.map((day, i) => h('tr', {},
                h('th', { scope: 'row' }, `Day ${i + 1}`, trip.startDate ? h('small', { class: 'report-edited' }, dayDate(trip.startDate, i)) : null,
                    trip.stops?.length ? h('small', { class: 'report-edited' }, stopOfDay(trip, i).destination) : null),
                SLOTS.map(([slot]) => h('td', {}, day[slot]))
            ))),
            trip.packing?.length ? h('section', {},
                h('h2', {}, 'Packing list'),
                h('ul', { class: 'report-checklist' }, trip.packing.map(entry => h('li', {}, `${entry.packed ? '☑' : '☐'} ${entry.item}`)))) : null,
            trip.budget?.currency ? h('p', {}, h('strong', {}, 'Spent so far: '),
                formatMoney(budgetTotals(trip.budget).total, trip.budget.currency)) : null
        ]
    });
}

function exportCalendar(trip) {
    const { calendar, error } = tripCalendar(trip);
    if (error) {
        toast(error, { tone: 'error' });
        return;
    }
    downloadFile(tripFileName(trip, 'ics'), calendar, 'text/calendar');
    toast('Calendar file downloaded: open it to add each day to your calendar.', { tone: 'success' });
}

// ---------------------------------------------------------------- the trip in the day ledger

// Once a trip has begun, it can be recorded as a visit to its destination.
function visitButton(ctx, trip, dirty) {
    if (!trip.startDate || trip.startDate > localToday()) return null;
    if (tripRecorded(ctx, trip)) return h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: true }, '✓ Recorded as a visit');
    return h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onclick: () => {
            if (dirty()) toast('Save your changes before recording the trip as a visit.', { tone: 'error' });
            else completeTrip(ctx, trip);
        }
    }, '✅ Record as a visit');
}

function ledgerButton(ctx, trip, dirty) {
    const planned = ctx.state.ledger.settings.planned.some(item => isTripPlan(trip, item.id));
    return h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        'aria-pressed': String(planned),
        onclick: () => {
            // The plan follows the saved trip, so unsaved dates must be saved first.
            if (dirty()) toast('Save your changes before planning the trip in the ledger.', { tone: 'error' });
            else toggleLedgerPlan(ctx, trip);
        }
    }, planned ? '📒 In ledger plans' : '📒 Plan in ledger');
}

// The ledger's planned stays for a trip, from its dates and the countries of its stops.
function tripStays(ctx, trip) {
    return tripPlannedStays(trip, destination => destinationPlace(ctx, destination)?.countryId);
}

// A trip planned in the ledger keeps its planned stays in step when it is saved or deleted.
async function followInLedger(ctx, trip, stays) {
    const { settings } = ctx.state.ledger;
    const planned = stays && syncPlannedStays(settings.planned, trip, stays);
    if (planned) await ctx.saveLedger({ ...settings, planned });
}

async function toggleLedgerPlan(ctx, trip) {
    const { settings } = ctx.state.ledger;
    try {
        if (settings.planned.some(item => isTripPlan(trip, item.id))) {
            await ctx.saveLedger({ ...settings, planned: settings.planned.filter(item => !isTripPlan(trip, item.id)) });
            toast('Taken out of the ledger plans.');
            return;
        }
        const { stays, unknown } = tripStays(ctx, trip);
        if (!stays?.length) {
            toast(unknown !== undefined
                ? `Which country is ${unknown} in? Name it in the destination, such as “Lisbon, Portugal”.`
                : 'Choose a start date to plan this trip in the day ledger.', { tone: 'error' });
            return;
        }
        await ctx.saveLedger({ ...settings, planned: [...settings.planned, ...stays] });
        toast('Planned in the ledger: the Ledger tab checks it against your stay rules and thresholds.', { tone: 'success' });
    } catch (error) {
        ctx.handleError(error);
    }
}

async function duplicateTrip(ctx, trip, container) {
    try {
        const copy = await ctx.api.createTrip(tripTemplate(trip));
        ctx.state.trips.unshift(copy);
        openTripId = copy.id;
        draft = null;
        toast(`Copied as “${copy.title}”. Choose new dates when you go.`, { tone: 'success' });
        renderTrips(container, ctx);
    } catch (error) {
        ctx.handleError(error);
    }
}

function renderEditor(container, ctx, trip) {
    // Trips cached by an earlier release have none of these.
    trip.stops ??= [];
    trip.packing ??= [];
    trip.budget ??= {};
    if (!draft || draft.id !== trip.id) {
        draft = structuredClone(trip);
    }
    const dirty = () => JSON.stringify(draft) !== JSON.stringify(trip);
    const rerender = () => renderEditor(container, ctx, trip);
    // Someone who can only view a shared trip reads it, copies, prints or exports it (ADR 0028).
    const readOnly = trip.role === 'view';
    const editable = (...children) => h('fieldset', { class: 'trip-edit', disabled: readOnly }, ...children);
    const saveButton = h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: !dirty() }, '💾 Save');
    const markDirty = () => { saveButton.disabled = !dirty(); };

    const save = async () => {
        saveButton.disabled = true;
        try {
            const saved = await ctx.api.updateTrip(trip.id, { ...draft, budget: tidyBudget(draft.budget) });
            Object.assign(trip, saved);
            draft = structuredClone(trip);
            await followInLedger(ctx, trip, tripStays(ctx, trip).stays);
            toast('Trip saved.', { tone: 'success' });
            rerender();
        } catch (error) {
            // Someone else saved meanwhile: their version replaces the draft (ADR 0028).
            if (error.status === 409 && error.data?.trip) {
                Object.assign(trip, error.data.trip);
                draft = structuredClone(trip);
                toast(error.message, { tone: 'error' });
                rerender();
                return;
            }
            ctx.handleError(error);
            markDirty();
        }
    };
    saveButton.addEventListener('click', save);

    const fillIdeas = async event => {
        event.target.disabled = true;
        event.target.textContent = '✨ Thinking…';
        // Each stop gets ideas for its own destination.
        const plans = await Promise.all(tripStops(draft).map(stop => (stop.destination
            ? ideasPlan(stop.destination, stop.days) : Array.from({ length: stop.days }, emptyDay))));
        const plan = plans.flat();
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

    // A day's stop on the map, or a word when it is no known place.
    const showStop = i => {
        const point = showItinerary(ctx, draft, tripStops(draft).findIndex(stop => i >= stop.firstDay && i < stop.firstDay + stop.days));
        if (point) ctx.map.flyTo(point.lat, point.lng);
        else toast(`Which place is ${stopOfDay(draft, i).destination || 'this stop'}? Name a country or a town, such as “Lisbon, Portugal”.`, { tone: 'error' });
    };
    const days = dayCards(draft, { rerender, markDirty, showStop, readOnly });

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
            readOnly ? null : saveButton
        ),
        sharedNote(trip),
        editable(h('div', { class: 'trip-meta' },
            h('label', { class: 'field' }, h('span', {}, 'Trip name'),
                h('input', { value: draft.title, maxlength: 120, oninput: event => { draft.title = event.target.value; markDirty(); } })),
            h('div', { class: 'row' },
                // A trip with stops names its destinations in the stops below.
                draft.stops?.length ? null : h('label', { class: 'field' }, h('span', {}, 'Destination'),
                    h('input', { value: draft.destination, maxlength: 160, oninput: event => { draft.destination = event.target.value; markDirty(); } })),
                h('label', { class: 'field' }, h('span', {}, 'Start date'),
                    h('input', { type: 'date', value: draft.startDate, onchange: event => { draft.startDate = event.target.value; rerender(); } }))
            ),
            stopsSection(draft, { rerender, markDirty })
        )),
        h('div', { class: 'row trip-tools' },
            readOnly ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: fillIdeas }, '✨ Fill empty slots'),
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
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => ctx.showIdeas(draft.destination) }, '💡 Ideas'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exportCalendar(draft) }, '📅 Calendar'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: event => printTrip(draft, event.currentTarget) }, '🖨️ Print'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
                // The copy is made from the saved trip, so unsaved edits are not left behind unseen.
                if (dirty()) toast('Save your changes before duplicating the trip.', { tone: 'error' });
                else duplicateTrip(ctx, trip, container);
            } }, '⧉ Duplicate'),
            ledgerButton(ctx, trip, dirty),
            visitButton(ctx, trip, dirty),
            shareButton(ctx, trip, dirty)
        ),
        editable(
            h('div', { class: 'days' }, days),
            packingSection(draft, { rerender, markDirty }),
            budgetSection(draft, { rerender, markDirty, trips: ctx.state.trips })
        ),
        h('div', { class: 'row trip-footer' },
            readOnly ? h('span') : h('button', {
                type: 'button',
                class: 'btn btn-ghost btn-sm',
                disabled: draft.plan.length >= MAX_DAYS,
                onclick: () => {
                    addTripDay(draft);
                    rerender();
                }
            }, '＋ Add a day'),
            ownsTrip(trip) ? h('button', {
                type: 'button',
                class: 'btn btn-danger-ghost btn-sm',
                onclick: async () => {
                    if (!(await ctx.confirmDialog({ title: `Delete “${trip.title}”?`, message: 'This itinerary will be gone for good.', confirmLabel: 'Delete trip', danger: true }))) return;
                    try {
                        await ctx.api.deleteTrip(trip.id);
                        ctx.state.trips = ctx.state.trips.filter(item => item.id !== trip.id);
                        await followInLedger(ctx, trip, []);
                        openTripId = null;
                        draft = null;
                        toast('Trip deleted.');
                        ctx.refresh();
                    } catch (error) {
                        ctx.handleError(error);
                    }
                }
            }, '🗑️ Delete trip') : h('button', {
                type: 'button',
                class: 'btn btn-danger-ghost btn-sm',
                onclick: async () => {
                    if (!(await leaveTrip(ctx, trip))) return;
                    ctx.state.trips = ctx.state.trips.filter(item => item.id !== trip.id);
                    await followInLedger(ctx, trip, []).catch(error => ctx.handleError(error));
                    openTripId = null;
                    draft = null;
                    ctx.refresh();
                }
            }, '🚪 Leave trip')
        )
    );
    showItinerary(ctx, draft);
}

// The stops of the open trip on the map, where they are known places, with `focus` bigger.
function showItinerary(ctx, trip, focus = -1) {
    const points = tripStops(trip).map(stop => {
        const where = destinationPlace(ctx, stop.destination);
        if (where?.city) return { lat: where.city.lat, lng: where.city.lng };
        return where ? { lat: where.country.label[0], lng: where.country.label[1] } : null;
    });
    const known = points.filter(Boolean);
    ctx.map?.setItinerary(known, focus < 0 || !points[focus] ? -1 : known.indexOf(points[focus]));
    return points[focus] || null;
}

export function renderTrips(container, ctx) {
    const trip = ctx.state.trips.find(item => item.id === openTripId);
    if (trip) renderEditor(container, ctx, trip);
    else {
        ctx.map?.setItinerary([]);
        renderList(container, ctx);
    }
}
