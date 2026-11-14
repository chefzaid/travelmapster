// The passport's flight log: flights added by date and airport codes, the distance flown per
// year with a rough CO₂ estimate, and a replay of the arcs on the map (flight-log.js). The
// airports (public/data/airports.json) load only once the section is first drawn.
import { h, fill, toast, formatDate } from './ui.js';
import { CO2_KG_PER_KM, FLIGHTS_MAX, airportIndex, airportLabel, checkFlight, flightArcs, flightKm, flightStats, latestFirst } from './flight-log.js';
import { formatDistance } from './units.js';
import { formatNumber, joinList, t, tn } from './i18n.js';

const SHOWN = 20;
let airportsPromise = null;
let showAll = false;

const loadAirports = () => {
    airportsPromise ||= fetch(new URL('../data/airports.json', import.meta.url)).then(res => res.json()).then(airportIndex);
    return airportsPromise;
};

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

function flightItem(ctx, airports, flight, redraw) {
    const km = flightKm(flight, airports);
    return h('li', { class: 'ledger-item' },
        h('span', { class: 'ledger-item-text' },
            h('strong', {}, `${airportLabel(airports, flight.from)} → ${airportLabel(airports, flight.to)}`),
            h('small', {}, [formatDate(flight.date), flight.number, km === null ? null : formatDistance(km)].filter(Boolean).join(' · '))),
        h('button', {
            type: 'button', class: 'icon-btn', title: t('Remove'),
            'aria-label': t('Remove the flight of {date} from {from} to {to}', { date: formatDate(flight.date), from: flight.from, to: flight.to }),
            onclick: async () => {
                try {
                    await ctx.api.deleteFlight(flight.id);
                    ctx.state.flights = ctx.state.flights.filter(item => item.id !== flight.id);
                    toast(t('Flight removed.'));
                    redraw();
                } catch (error) {
                    ctx.handleError(error);
                }
            }
        }, '🗑️'));
}

function draw(ctx, body, airports) {
    const redraw = () => draw(ctx, body, airports);
    const flights = ctx.state.flights;
    const { years, total, unknown } = flightStats(flights, airports);
    const shown = showAll ? flights : flights.slice(0, SHOWN);
    fill(body,
        flights.length ? h('p', { class: 'flight-total' }, h('strong', {}, t('{flights} · {distance} · about {co2} t of CO₂', {
            flights: tn(total.flights, '{count} flight', '{count} flights'), distance: formatDistance(total.km), co2: tonnes(total.co2Kg)
        }))) : h('p', { class: 'muted small' }, t('Add the flights you took to see the distance you flew each year, and replay them on the map.')),
        years.length ? h('ul', { class: 'flight-years' }, years.map(year => h('li', {},
            t('{year}: {flights}, {distance}, about {co2} t of CO₂', {
                year: year.year, flights: tn(year.flights, '{count} flight', '{count} flights'), distance: formatDistance(year.km), co2: tonnes(year.co2Kg)
            })))) : null,
        unknown.length ? h('p', { class: 'hint' }, t('Unknown airport codes, counted without a distance: {codes}.', { codes: joinList(unknown) })) : null,
        flights.length ? h('p', { class: 'hint' }, t('CO₂ is a rough estimate of {grams} g per kilometre for an economy seat; real flights vary a lot.', { grams: CO2_KG_PER_KM * 1000 })) : null,
        flights.length ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => ctx.map.replayJourneys(flightArcs(flights, airports), { reduceMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) })
        }, t('🗺️ Replay on the map')) : null,
        flights.length < FLIGHTS_MAX ? addForm(ctx, airports, redraw) : null,
        flights.length ? h('ul', { class: 'ledger-list', id: 'flight-list' }, shown.map(flight => flightItem(ctx, airports, flight, redraw))) : null,
        flights.length > SHOWN && !showAll ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => {
                showAll = true;
                redraw();
            }
        }, tn(flights.length, 'Show all {count} flight', 'Show all {count} flights')) : null);
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
