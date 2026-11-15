// The passport's flight log: flights added by date and airport codes, the distance flown per
// year with a rough CO₂ estimate, and a replay of the arcs on the map (flight-log.js). The
// airports (public/data/airports.json) load only once the section is first drawn.
import { h, fill, toast, formDialog, formatDate, downloadFile } from './ui.js';
import { readPastedFlights } from './flight-paste.js';
import {
    CO2_KG_PER_KM, FLIGHTS_MAX, airportLabel, checkFlight, flightArcs, flightFavourites, flightKm, flightStats, flightsCsv, flightsOfYear, latestFirst, yearInFlights
} from './flight-log.js';
import { flightsCard } from './share-cards.js';
import { loadAirports } from './airports-data.js';
import { formatDistance } from './units.js';
import { formatNumber, joinList, t, tn } from './i18n.js';

const SHOWN = 20;
let showAll = false;
// The year the list shows, or '' for all of them.
let shownYear = '';

const tonnes = kg => formatNumber(Math.round(kg / 100) / 10);

function addForm(ctx, airports, redraw) {
    const name = code => (code.length === 3 ? airportLabel(airports, code.toUpperCase()) : '');
    const fields = ['from', 'to'].map(key => {
        const hint = h('small', { class: 'muted', 'aria-live': 'polite' });
        const input = h('input', {
            name: key, maxlength: 3, size: 4, required: true, autocomplete: 'off', class: 'airport-code',
            placeholder: key === 'from' ? 'LIS' : 'KIX', 'aria-label': key === 'from' ? t('From airport code') : t('To airport code'),
            oninput: event => { hint.textContent = name(event.target.value.trim()); }
        });
        return h('label', { class: 'field' }, h('span', {}, key === 'from' ? t('From') : t('To')), input, hint);
    });
    return h('form', {
        class: 'row flight-add',
        onsubmit: async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const { flight, error } = checkFlight(Object.fromEntries(new FormData(form)));
            if (error) {
                toast(error, { tone: 'error' });
                return;
            }
            try {
                ctx.state.flights = latestFirst([await ctx.api.addFlight(flight), ...ctx.state.flights]);
                form.reset();
                toast(t('Flight added: {from} to {to}.', { from: airportLabel(airports, flight.from), to: airportLabel(airports, flight.to) }), { tone: 'success' });
                redraw();
            } catch (failure) {
                ctx.handleError(failure);
            }
        }
    },
        h('label', { class: 'field' }, h('span', {}, t('Date')), h('input', { name: 'date', type: 'date', required: true })),
        ...fields,
        h('label', { class: 'field' }, h('span', {}, t('Flight number')), h('input', { name: 'number', maxlength: 12, size: 8, autocomplete: 'off', placeholder: 'TP 1352' })),
        h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, t('＋ Add flight')));
}

// Many flights at once, pasted as lines or an app's CSV export, after a look at what was read.
async function pasteFlights(ctx, redraw) {
    const pasted = await formDialog({
        title: t('Paste your flights'),
        message: t('One flight a line, such as "2026-05-01 LIS KIX TP1352", or a CSV with date, from and to columns as airline and flight tracking apps export.'),
        submitLabel: t('Read them'),
        fields: [{ name: 'text', label: t('Flights'), type: 'textarea', required: true }]
    });
    if (!pasted?.text?.trim()) return;
    const { flights, skipped, known, tooMany } = readPastedFlights(pasted.text, ctx.state.flights);
    const notes = [
        known ? tn(known, '{count} is already in your log.', '{count} are already in your log.') : null,
        tooMany ? tn(tooMany, '{count} more are left for another paste: at most 500 at once.', '{count} more are left for another paste: at most 500 at once.') : null,
        skipped.length ? t('Not understood: {lines}', { lines: skipped.slice(0, 5).join(' / ') }) : null
    ].filter(Boolean).join(' ');
    if (!flights.length) {
        toast([t('No new flight found.'), notes].filter(Boolean).join(' '), { tone: 'error', duration: 8000 });
        return;
    }
    if (!(await ctx.confirmDialog({ title: tn(flights.length, 'Add {count} flight?', 'Add {count} flights?'), message: notes || t('Every line was understood.'), confirmLabel: t('Add them') }))) return;
    try {
        const { flights: added, full } = await ctx.api.importFlights(flights);
        ctx.state.flights = latestFirst([...added, ...ctx.state.flights]);
        toast(full ? tn(added.length, 'Added {count} flight: the log is full.', 'Added {count} flights: the log is full.') : tn(added.length, 'Added {count} flight.', 'Added {count} flights.'), { tone: 'success' });
        redraw();
    } catch (error) {
        ctx.handleError(error);
    }
}

// Changes a flight in a dialog, kept open with what was typed until it checks out.
async function editFlight(ctx, flight, redraw) {
    let draft = flight;
    for (;;) {
        const values = await formDialog({
            title: t('Edit the flight'),
            submitLabel: t('Save flight'),
            fields: [
                { name: 'date', label: t('Date'), type: 'date', value: draft.date, required: true },
                { name: 'from', label: t('From airport code'), value: draft.from, required: true, maxlength: 3, autocomplete: 'off' },
                { name: 'to', label: t('To airport code'), value: draft.to, required: true, maxlength: 3, autocomplete: 'off' },
                { name: 'number', label: t('Flight number'), value: draft.number || '', maxlength: 12, autocomplete: 'off', placeholder: 'TP 1352' }
            ]
        });
        if (!values) return;
        const { flight: checked, error } = checkFlight(values);
        if (error) {
            toast(error, { tone: 'error' });
            draft = { ...values, id: flight.id };
            continue;
        }
        try {
            const changed = await ctx.api.updateFlight(flight.id, checked);
            ctx.state.flights = latestFirst(ctx.state.flights.map(item => (item.id === flight.id ? changed : item)));
            toast(t('Flight saved.'), { tone: 'success' });
            redraw();
        } catch (failure) {
            ctx.handleError(failure);
        }
        return;
    }
}

// Fills the add form with the flight the other way, from the day it flew, for its date to be picked.
function fillWayBack(section, flight) {
    const form = /** @type {HTMLFormElement | null} */ (section?.querySelector('.flight-add'));
    if (!form) return;
    const set = (name, value) => {
        const input = /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
        input.value = value;
        input.dispatchEvent(new Event('input'));
    };
    set('from', flight.to);
    set('to', flight.from);
    set('number', '');
    const date = /** @type {HTMLInputElement} */ (form.elements.namedItem('date'));
    date.min = flight.date;
    date.scrollIntoView({ block: 'center', behavior: 'smooth' });
    date.focus({ preventScroll: true });
}

// Puts a removed flight back, from the Undo of its toast.
async function restoreFlight(ctx, flight, redraw) {
    try {
        ctx.state.flights = latestFirst([await ctx.api.addFlight(flight), ...ctx.state.flights]);
        redraw();
    } catch (error) {
        ctx.handleError(error);
    }
}

function flightItem(ctx, airports, flight, redraw) {
    const km = flightKm(flight, airports);
    return h('li', { class: 'ledger-item' },
        h('span', { class: 'ledger-item-text' },
            h('strong', {}, `${airportLabel(airports, flight.from)} → ${airportLabel(airports, flight.to)}`),
            h('small', {}, [formatDate(flight.date), flight.number, km === null ? null : formatDistance(km)].filter(Boolean).join(' · '))),
        h('button', {
            type: 'button', class: 'icon-btn', title: t('Way back'),
            'aria-label': t('Add the way back from {from} to {to}', { from: flight.to, to: flight.from }),
            onclick: event => fillWayBack(event.currentTarget.closest('section'), flight)
        }, '↩️'),
        h('button', {
            type: 'button', class: 'icon-btn', title: t('Edit'),
            'aria-label': t('Edit the flight of {date} from {from} to {to}', { date: formatDate(flight.date), from: flight.from, to: flight.to }),
            onclick: () => editFlight(ctx, flight, redraw)
        }, '✏️'),
        h('button', {
            type: 'button', class: 'icon-btn', title: t('Remove'),
            'aria-label': t('Remove the flight of {date} from {from} to {to}', { date: formatDate(flight.date), from: flight.from, to: flight.to }),
            onclick: async () => {
                try {
                    await ctx.api.deleteFlight(flight.id);
                    ctx.state.flights = ctx.state.flights.filter(item => item.id !== flight.id);
                    toast(t('Flight removed.'), { action: { label: t('Undo'), run: () => restoreFlight(ctx, flight, redraw) } });
                    redraw();
                } catch (error) {
                    ctx.handleError(error);
                }
            }
        }, '🗑️'));
}

// The route flown most and the airport used most, once there is one of each.
function favouritesLine(flights, airports) {
    const { route, airport } = flightFavourites(flights);
    const parts = [
        route ? tn(route.count, 'Most flown: {from} ⇄ {to}, {count} time', 'Most flown: {from} ⇄ {to}, {count} times', { from: route.from, to: route.to }) : null,
        airport ? tn(airport.count, 'Busiest airport: {airport}, {count} flight', 'Busiest airport: {airport}, {count} flights', { airport: airportLabel(airports, airport.code) }) : null
    ].filter(Boolean);
    return parts.length ? h('p', { class: 'flight-favourites' }, parts.join(' · ')) : null;
}

// The latest year with flights as a square picture, through the passport's share cards.
function shareYearButton(ctx, airports, year) {
    return h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: async () => {
            const summary = yearInFlights(ctx.state.flights, airports, year);
            const { shareCard } = await import('./passport-share.js');
            const { flight, km } = summary.longest;
            await shareCard(flightsCard({
                username: ctx.state.user.username, year, flights: summary.flights, distance: formatDistance(summary.km), laps: summary.laps,
                longest: km ? `${flight.from} → ${flight.to} · ${formatDistance(km)}` : ''
            }), `travelmapster-flights-${year}.png`, t('{username} on TravelMapster', { username: ctx.state.user.username }));
        }
    }, t('📸 {year} in flights', { year }));
}

// Which year's flights the list shows, once there are flights in more than one.
function yearPicker(years, redraw) {
    return h('label', { class: 'field flight-year-pick' }, h('span', {}, t('Show')),
        h('select', {
            onchange: event => {
                shownYear = event.target.value;
                redraw();
            }
        },
            h('option', { value: '', selected: !shownYear }, t('All years')),
            years.map(({ year }) => h('option', { value: String(year), selected: String(year) === shownYear }, String(year)))));
}

function draw(ctx, body, airports) {
    const redraw = () => draw(ctx, body, airports);
    const flights = ctx.state.flights;
    const { years, total, unknown } = flightStats(flights, airports);
    if (!years.some(year => String(year.year) === shownYear)) shownYear = '';
    const listed = flightsOfYear(flights, shownYear);
    const shown = showAll ? listed : listed.slice(0, SHOWN);
    fill(body,
        flights.length ? h('p', { class: 'flight-total' }, h('strong', {}, t('{flights} · {distance} · about {co2} t of CO₂', {
            flights: tn(total.flights, '{count} flight', '{count} flights'), distance: formatDistance(total.km), co2: tonnes(total.co2Kg)
        }))) : h('p', { class: 'muted small' }, t('Add the flights you took to see the distance you flew each year, and replay them on the map.')),
        years.length ? h('ul', { class: 'flight-years' }, years.map(year => h('li', {},
            t('{year}: {flights}, {distance}, about {co2} t of CO₂', {
                year: year.year, flights: tn(year.flights, '{count} flight', '{count} flights'), distance: formatDistance(year.km), co2: tonnes(year.co2Kg)
            })))) : null,
        favouritesLine(flights, airports),
        unknown.length ? h('p', { class: 'hint' }, t('Unknown airport codes, counted without a distance: {codes}.', { codes: joinList(unknown) })) : null,
        flights.length ? h('p', { class: 'hint' }, t('CO₂ is a rough estimate of {grams} g per kilometre for an economy seat; real flights vary a lot.', { grams: CO2_KG_PER_KM * 1000 })) : null,
        years.length ? shareYearButton(ctx, airports, years[0].year) : null,
        flights.length ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => downloadFile(`travelmapster-flights-${new Date().toISOString().slice(0, 10)}.csv`, flightsCsv(flights, airports), 'text/csv')
        }, t('⬇️ CSV')) : null,
        flights.length ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => ctx.map.replayJourneys(flightArcs(flights, airports), { reduceMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) })
        }, t('🗺️ Replay on the map')) : null,
        flights.length < FLIGHTS_MAX ? addForm(ctx, airports, redraw) : null,
        flights.length < FLIGHTS_MAX ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => pasteFlights(ctx, redraw) }, t('📥 Paste flights')) : null,
        years.length > 1 ? yearPicker(years, redraw) : null,
        flights.length ? h('ul', { class: 'ledger-list', id: 'flight-list' }, shown.map(flight => flightItem(ctx, airports, flight, redraw))) : null,
        listed.length > SHOWN && !showAll ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => {
                showAll = true;
                redraw();
            }
        }, tn(listed.length, 'Show all {count} flight', 'Show all {count} flights')) : null);
}

/** The flight log section; its flights and the airports load once, the first time it is drawn. */
export function flightsSection(ctx) {
    const body = h('div', {}, h('p', { class: 'muted small' }, t('Loading…')));
    Promise.all([loadAirports(), ctx.state.flights ? ctx.state.flights : ctx.api.getFlights()])
        .then(([airports, flights]) => {
            ctx.state.flights = flights;
            draw(ctx, body, airports);
        })
        .catch(() => fill(body, h('p', { class: 'muted small' }, t('The flight log could not be loaded.'))));
    return h('section', { 'aria-labelledby': 'flights-title' },
        h('h3', { class: 'section-title', id: 'flights-title' }, t('✈️ Flight log')), body);
}
