// The timeline bar (ADR 0016): the map by the end of a year or during it, journey lines and
// their replay. The year and journey logic is in timeline.js and journeys.js.
import { h, $, $all, formatDate } from './ui.js';
import { countryStatus } from './geo.js';
import { localToday } from './days.js';
import { placesInYear, timelineYears } from './timeline.js';
import { groupTrips, journeyArc, journeyLegs, journeyStops, routeLabel } from './journeys.js';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const countryOf = ctx => marker => ctx.state.stats.markerCountry.get(marker.id);

// The map by the end of the chosen year, or during it, while the timeline is open; null when it
// is closed or no visit has a date.
export function timelineView(ctx) {
    const { state } = ctx;
    const { open, mode } = state.timeline;
    if (!open || !state.stats) return null;
    const today = localToday();
    const years = timelineYears(state.markers, today);
    if (!years) return null;
    const year = Math.min(Math.max(state.timeline.year ?? years.latest, years.first), years.last);
    state.timeline.year = year;
    return { years, year, mode, ...placesInYear(state.markers, { year, mode, today }) };
}

// Visitors of a public map see journey lines only when its owner shares them.
function journeysAllowed(ctx) {
    return !ctx.state.publicUser || ctx.state.publicJourneys;
}

function stopsOf(ctx, markers) {
    return journeyStops(markers, { countryOf: countryOf(ctx), today: localToday() });
}

export function renderTimeline(ctx, view, visible) {
    const { state, map } = ctx;
    if (!state.timeline.open) {
        map.setJourneys([]);
        return;
    }
    const range = $('#time-year');
    const summary = $('#time-summary');
    range.disabled = !view;
    $('#time-journeys').hidden = !view || !journeysAllowed(ctx);
    if (!view) {
        $('#time-year-value').textContent = '';
        range.removeAttribute('aria-valuetext');
        summary.textContent = state.user
            ? 'Add dates to your visits to see your map year by year.'
            : 'No visit on this map has dates yet.';
        map.setJourneys([]);
        return;
    }
    range.min = view.years.first;
    range.max = view.years.last;
    range.value = view.year;
    const during = view.mode === 'during';
    const words = during ? `During ${view.year}` : `By the end of ${view.year}`;
    range.setAttribute('aria-valuetext', words);
    $('#time-year-value').textContent = view.year;
    // Countries been to, on the traveler's country list; the home country has no dates, so it
    // is always drawn but counted only by the end of a year.
    const been = countryStatus(view.markers, countryOf(ctx), { homeId: during ? null : state.stats.homeId }).visitedIds;
    const count = [...been].filter(id => state.stats.countedIds.has(id)).length;
    const text = `${words}: ${plural(count, 'country', 'countries')} ${during ? 'visited' : 'been to'}.`
        + (view.undated ? ` ${plural(view.undated, 'place', 'places')} without dates ${view.undated === 1 ? 'is' : 'are'} not shown.` : '');
    // The summary is a live region: only a change is announced.
    if (summary.textContent !== text) summary.textContent = text;
    renderJourneys(ctx, view, visible);
}

// The journey lines of the places shown, and the year's trips to replay.
function renderJourneys(ctx, view, visible) {
    const { state, map } = ctx;
    if (!journeysAllowed(ctx)) {
        map.setJourneys([]);
        return;
    }
    const yearStops = stopsOf(ctx, placesInYear(visible, { year: view.year, mode: 'during', today: localToday() }).markers);
    const trips = groupTrips(yearStops);
    const choices = new Map([['year', yearStops]]);
    const options = [h('option', { value: 'year' }, `Every journey in ${view.year}`)];
    for (const trip of trips) {
        const key = `${trip.startDate}:${trip.stops[0].markerId}`;
        choices.set(key, trip.stops);
        options.push(h('option', { value: key }, `${formatDate(trip.startDate)}: ${routeLabel(trip.stops)}`));
    }
    const pick = $('#journey-pick');
    const chosen = choices.has(pick.value) ? pick.value : 'year';
    state.timeline.choices = choices;
    pick.replaceChildren(...options);
    pick.value = chosen;
    const canReplay = journeyLegs(yearStops).length > 0;
    pick.disabled = !canReplay;
    $('#journey-replay').disabled = !canReplay && !state.timeline.replaying;
    // A replay keeps its route on the map until something changes.
    if (state.timeline.replaying) return;
    const legs = state.timeline.journeys ? journeyLegs(stopsOf(ctx, visible)) : [];
    map.setJourneys(legs.map(({ from, to }) => journeyArc(from, to)));
}

function stopReplay(ctx) {
    ctx.state.timeline.stopReplay?.();
}

// Replays the chosen trip or the whole year, leg by leg; pressed again, it stops.
function toggleReplay(ctx) {
    const { timeline } = ctx.state;
    if (timeline.stopReplay) {
        stopReplay(ctx);
        ctx.applyFilters();
        return;
    }
    const stops = timeline.choices.get($('#journey-pick').value) || [];
    const legs = journeyLegs(stops);
    if (!legs.length) return;
    const button = $('#journey-replay');
    const now = $('#journey-now');
    const leg = $('#journey-leg');
    const route = routeLabel(stops, 8);
    button.textContent = '■ Stop';
    now.textContent = `Replaying ${plural(legs.length, 'journey', 'journeys')}: ${route}.`;
    timeline.replaying = true;
    const stop = ctx.map.replayJourneys(legs.map(({ from, to }) => journeyArc(from, to)), {
        reduceMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
        onLeg: i => {
            leg.textContent = `✈️ ${legs[i].from.name} → ${legs[i].to.name} · ${formatDate(legs[i].to.startDate)}`;
        },
        onDone: finished => {
            timeline.replaying = false;
            timeline.stopReplay = null;
            button.textContent = '▶ Replay';
            now.textContent = finished ? `Replay finished: ${route}.` : 'Replay stopped.';
            if (!finished) leg.textContent = '';
        }
    });
    // With reduced motion the replay has already finished.
    timeline.stopReplay = timeline.replaying ? stop : null;
}

// On phones, tucks the bottom sheet away so the map has room.
export function collapsePanelOnPhones() {
    if (window.innerWidth > 760) return;
    $('#panel').classList.add('is-collapsed');
    $('#panel-handle').setAttribute('aria-expanded', 'false');
}

export function setTimelineOpen(ctx, open) {
    const { state } = ctx;
    const bar = $('#time-bar');
    const hadFocus = bar.contains(document.activeElement);
    if (!open) stopReplay(ctx);
    state.timeline.open = open;
    bar.hidden = !open;
    $('#timeline-btn').setAttribute('aria-expanded', String(open));
    $('#journey-now').textContent = '';
    $('#journey-leg').textContent = '';
    if (open) {
        ctx.stopSelecting();
        ctx.map.closePopup();
        // Above the timeline, the map shows rather than the bottom sheet.
        collapsePanelOnPhones();
    }
    if (state.stats) ctx.applyFilters();
    if (open) ($('#time-year').disabled ? $('#time-close') : $('#time-year')).focus();
    else if (hadFocus) $('#timeline-btn').focus();
}

export function setupTimeline(ctx) {
    const { timeline } = ctx.state;
    const change = update => {
        stopReplay(ctx);
        update();
        ctx.applyFilters();
    };
    $('#timeline-btn').addEventListener('click', () => setTimelineOpen(ctx, !timeline.open));
    $('#time-close').addEventListener('click', () => setTimelineOpen(ctx, false));
    $('#time-bar').addEventListener('keydown', event => {
        if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setTimelineOpen(ctx, false);
    });
    $('#time-year').addEventListener('input', event => change(() => { timeline.year = Number(event.target.value); }));
    for (const radio of $all('input[name="time-mode"]')) {
        radio.addEventListener('change', () => change(() => { timeline.mode = radio.value; }));
    }
    $('#journey-toggle').addEventListener('change', event => change(() => { timeline.journeys = event.target.checked; }));
    $('#journey-pick').addEventListener('change', () => {
        if (timeline.stopReplay) toggleReplay(ctx);
    });
    $('#journey-replay').addEventListener('click', () => toggleReplay(ctx));
}
