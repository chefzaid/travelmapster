import { api } from './api.js';
import { createCountryIndex, computeStats, countryLook, countryStatus, searchCities, formatPopulation, CONTINENTS, CONTINENT_EMOJI, flagEmoji } from './geo.js';
import { createTravelMap } from './map.js';
import { h, $, $all, fill, toast, confirmDialog, formDialog, formatDate } from './ui.js';
import { checkVisit, formatVisitDates, sortVisits, lastVisitDate, visitCountLabel, visitDays } from './visits.js';
import {
    EMOJI_CHOICES, MONTH_NAMES, PRIORITIES, checkDetails, describeDetailFilter, detailFilterActive, knownTags, matchesDetails,
    monthsLabel, nextInSeason, parseRating, priorityLabel, ratingLabel, splitTags, stars
} from './details.js';
import { fetchIdeas } from './ideas.js';
import { renderPlaces } from './places.js';
import { renderTrips, openNewTrip } from './trips.js';
import { renderPassport, renderPublicStats } from './passport.js';
import { renderLedger } from './ledger.js';
import { SCHENGEN_RULE, ledgerOverview, localToday } from './days.js';
import { DEMO_HOME, demoMarkers } from './demo.js';
import { HOME, STATUSES, statusFields, statusInfo, statusLabel, statusOf } from './status.js';
import { COUNTRY_LISTS, countedCountries, shareLabel } from './lists.js';
import { applyBulkResult, bulkRequest, bulkSummary, planBulkMark, undoRequest } from './bulk.js';
import { placesInYear, timelineYears } from './timeline.js';
import { groupTrips, journeyArc, journeyLegs, journeyStops, routeLabel } from './journeys.js';
import { PALETTES, paletteId } from './palettes.js';
import { celebrate } from './confetti.js';

const state = {
    user: null,
    markers: [],
    trips: [],
    stats: null,
    index: null,
    cities: [],
    publicUser: null,
    // The shared map owner's country list, so visitors see the same counts, and whether they
    // let visitors see journey lines (ADR 0016).
    publicCountryList: 'all',
    publicJourneys: false,
    // Signed out, the map shows a sample traveler that visitors can try; nothing is saved.
    demo: false,
    // The legend's status toggles, and the tag and rating filter shared by the map and the Places tab.
    filters: { visited: true, lived: true, transit: true, wishlist: true, tag: 'all', rating: 'all' },
    activeTab: 'explore',
    // Countries picked on the map to mark at once, or null when not picking.
    selection: null,
    // The timeline (ADR 0016): the map by the end of a year or during it, journey lines, the
    // replay choices for the year and a function that stops a running replay.
    timeline: { open: false, year: null, mode: 'by', journeys: false, choices: new Map(), replaying: false, stopReplay: null },
    ideas: null,
    unlocked: null,
    // Day ledger: settings from the API, the history of visit dates (loaded when needed)
    // and the overview computed from both, cleared whenever places or visits change.
    ledger: { settings: { dayRule: 'presence', rules: [], planned: [] }, changes: null, overview: null, alerted: false }
};

let travelMap;

// ---------------------------------------------------------------- data

async function loadMapData() {
    const [countries, cities] = await Promise.all([
        // Relative to this module, so data comes from the same release as the code.
        fetch(new URL('../data/countries.geojson', import.meta.url)).then(res => res.json()),
        fetch(new URL('../data/cities.json', import.meta.url)).then(res => res.json())
    ]);
    state.index = createCountryIndex(countries);
    state.cities = cities;
}

function capitalOf(country) {
    return state.cities.find(city => city.capital && city.countryId === country.id);
}

function markersForCountry(country) {
    return state.markers.filter(marker => state.stats?.markerCountry.get(marker.id)?.id === country.id);
}

function countryMarker(country) {
    return markersForCountry(country).find(marker => marker.category === 'Country');
}

function cityMarkerFor(city) {
    const label = `${city.name}, ${city.country}`.toLowerCase();
    return state.markers.find(marker => marker.category === 'City' && (
        marker.name.toLowerCase() === label ||
        (Math.abs(marker.lat - city.lat) < 0.15 && Math.abs(marker.lng - city.lng) < 0.15)
    ));
}

// The traveler's home country (ADR 0014); the demo traveler has one too. Public maps never share it.
function homeCountryId() {
    if (state.user) return state.user.homeCountry || null;
    return state.demo ? DEMO_HOME : null;
}

// The list of countries the passport counts against (ADR 0015).
function countryListId() {
    if (state.user) return state.user.countryList || 'all';
    return state.publicUser ? state.publicCountryList : 'all';
}

const countryOfMarker = marker => state.stats.markerCountry.get(marker.id);

// Colors countries and draws pins for the places that pass the timeline, the legend and the tag
// and rating filter; the legend counts and the passport always count every place.
function applyFilters() {
    const shown = Object.fromEntries(STATUSES.map(({ id }) => [id, state.filters[id]]));
    const filtered = detailFilterActive(state.filters);
    const timeline = timelineView();
    let markers = timeline ? timeline.markers : state.markers;
    if (filtered) markers = markers.filter(marker => matchesDetails(marker, state.filters));
    const status = filtered || timeline
        ? countryStatus(markers, countryOfMarker, { homeId: state.stats.homeId })
        : state.stats;
    travelMap.setCountryStatus(status, shown);
    const visible = markers.filter(marker => state.filters[statusOf(marker)]);
    travelMap.setPins(visible);
    renderTimeline(timeline, visible);
    const clear = $('#legend-detail-filter');
    clear.hidden = !filtered;
    if (filtered) {
        const description = describeDetailFilter(state.filters);
        clear.querySelector('.legend-filter-text').textContent = description;
        clear.setAttribute('aria-label', `Map filtered to ${description}. Clear the filter`);
    }
}

function setDetailFilter(changes) {
    Object.assign(state.filters, changes);
    applyFilters();
    renderActiveTab();
}

function refresh({ celebrateNew = true } = {}) {
    state.stats = computeStats(state.markers, state.index, {
        trips: state.trips.length, homeId: homeCountryId(), countryList: countryListId()
    });
    applyFilters();
    $('#legend-visited').textContent = state.stats.visitedCountries;
    $('#legend-lived').textContent = state.stats.livedCountries;
    $('#legend-transit').textContent = state.stats.transitCountries;
    $('#legend-wishlist').textContent = state.stats.wishlistCountries;
    // Statuses nobody uses stay out of the legend, which has little room on phones.
    $('#legend-lived-item').hidden = !state.stats.livedCountries && state.filters.lived;
    $('#legend-transit-item').hidden = !state.stats.transitCountries && state.filters.transit;
    const home = state.index.byId.get(state.stats.homeId);
    $('#legend-home').hidden = !home;
    if (home) $('#legend-home-name').textContent = home.name;

    const unlocked = new Set(state.stats.achievements.filter(a => a.unlocked).map(a => a.id));
    if (state.unlocked && celebrateNew) {
        const fresh = state.stats.achievements.filter(a => a.unlocked && !state.unlocked.has(a.id));
        for (const achievement of fresh) {
            celebrate();
            toast(`Badge unlocked: ${achievement.icon} ${achievement.title}!`, { tone: 'success', duration: 5000 });
        }
    }
    state.unlocked = unlocked;
    state.ledger.overview = null;
    state.ledger.changes = null;
    updateLedgerBadge();
    renderActiveTab();
    if (state.demo) renderDemoLedger();
}

// ---------------------------------------------------------------- timeline and journeys

// The map by the end of the chosen year, or during it, while the timeline is open; null when it
// is closed or no visit has a date (ADR 0016).
function timelineView() {
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
function journeysAllowed() {
    return !state.publicUser || state.publicJourneys;
}

function stopsOf(markers) {
    return journeyStops(markers, { countryOf: countryOfMarker, today: localToday() });
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function renderTimeline(view, visible) {
    if (!state.timeline.open) {
        travelMap.setJourneys([]);
        return;
    }
    const range = $('#time-year');
    const summary = $('#time-summary');
    range.disabled = !view;
    $('#time-journeys').hidden = !view || !journeysAllowed();
    if (!view) {
        $('#time-year-value').textContent = '';
        range.removeAttribute('aria-valuetext');
        summary.textContent = state.user
            ? 'Add dates to your visits to see your map year by year.'
            : 'No visit on this map has dates yet.';
        travelMap.setJourneys([]);
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
    const been = countryStatus(view.markers, countryOfMarker, { homeId: during ? null : state.stats.homeId }).visitedIds;
    const count = [...been].filter(id => state.stats.countedIds.has(id)).length;
    const text = `${words}: ${plural(count, 'country', 'countries')} ${during ? 'visited' : 'been to'}.`
        + (view.undated ? ` ${plural(view.undated, 'place', 'places')} without dates ${view.undated === 1 ? 'is' : 'are'} not shown.` : '');
    // The summary is a live region: only a change is announced.
    if (summary.textContent !== text) summary.textContent = text;
    renderJourneys(view, visible);
}

// The journey lines of the places shown, and the year's trips to replay.
function renderJourneys(view, visible) {
    if (!journeysAllowed()) {
        travelMap.setJourneys([]);
        return;
    }
    const yearStops = stopsOf(placesInYear(visible, { year: view.year, mode: 'during', today: localToday() }).markers);
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
    const legs = state.timeline.journeys ? journeyLegs(stopsOf(visible)) : [];
    travelMap.setJourneys(legs.map(({ from, to }) => journeyArc(from, to)));
}

function stopReplay() {
    state.timeline.stopReplay?.();
}

// Replays the chosen trip or the whole year, leg by leg; pressed again, it stops.
function toggleReplay() {
    if (state.timeline.stopReplay) {
        stopReplay();
        applyFilters();
        return;
    }
    const stops = state.timeline.choices.get($('#journey-pick').value) || [];
    const legs = journeyLegs(stops);
    if (!legs.length) return;
    const button = $('#journey-replay');
    const now = $('#journey-now');
    const leg = $('#journey-leg');
    const route = routeLabel(stops, 8);
    button.textContent = '■ Stop';
    now.textContent = `Replaying ${plural(legs.length, 'journey', 'journeys')}: ${route}.`;
    state.timeline.replaying = true;
    const stop = travelMap.replayJourneys(legs.map(({ from, to }) => journeyArc(from, to)), {
        reduceMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
        onLeg: i => {
            leg.textContent = `✈️ ${legs[i].from.name} → ${legs[i].to.name} · ${formatDate(legs[i].to.startDate)}`;
        },
        onDone: finished => {
            state.timeline.replaying = false;
            state.timeline.stopReplay = null;
            button.textContent = '▶ Replay';
            now.textContent = finished ? `Replay finished: ${route}.` : 'Replay stopped.';
            if (!finished) leg.textContent = '';
        }
    });
    // With reduced motion the replay has already finished.
    state.timeline.stopReplay = state.timeline.replaying ? stop : null;
}

function setTimelineOpen(open) {
    const bar = $('#time-bar');
    const hadFocus = bar.contains(document.activeElement);
    if (!open) stopReplay();
    state.timeline.open = open;
    bar.hidden = !open;
    $('#timeline-btn').setAttribute('aria-expanded', String(open));
    $('#journey-now').textContent = '';
    $('#journey-leg').textContent = '';
    if (open) {
        stopSelecting();
        travelMap.closePopup();
        // On phones, tuck the bottom sheet away so the map shows above the timeline.
        if (window.innerWidth <= 760) {
            $('#panel').classList.add('is-collapsed');
            $('#panel-handle').setAttribute('aria-expanded', 'false');
        }
    }
    if (state.stats) applyFilters();
    if (open) ($('#time-year').disabled ? $('#time-close') : $('#time-year')).focus();
    else if (hadFocus) $('#timeline-btn').focus();
}

function setupTimeline() {
    $('#timeline-btn').addEventListener('click', () => setTimelineOpen(!state.timeline.open));
    $('#time-close').addEventListener('click', () => setTimelineOpen(false));
    $('#time-bar').addEventListener('keydown', event => {
        if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setTimelineOpen(false);
    });
    $('#time-year').addEventListener('input', event => {
        stopReplay();
        state.timeline.year = Number(event.target.value);
        applyFilters();
    });
    for (const radio of $all('input[name="time-mode"]')) {
        radio.addEventListener('change', () => {
            stopReplay();
            state.timeline.mode = radio.value;
            applyFilters();
        });
    }
    $('#journey-toggle').addEventListener('change', event => {
        stopReplay();
        state.timeline.journeys = event.target.checked;
        applyFilters();
    });
    $('#journey-pick').addEventListener('change', () => {
        if (state.timeline.stopReplay) toggleReplay();
    });
    $('#journey-replay').addEventListener('click', toggleReplay);
}

// ---------------------------------------------------------------- palettes and printing

const PALETTE_KEY = 'travelmapster.palette';

function storedPalette() {
    try {
        return localStorage.getItem(PALETTE_KEY);
    } catch {
        return null;
    }
}

// Switches the map colors (ADR 0016); the CSS tokens change, then the map redraws from them.
// The choice is remembered in this browser, so the next visit starts with it.
function applyPalette(id) {
    const palette = paletteId(id);
    const root = document.documentElement;
    const changed = (root.dataset.palette || 'standard') !== palette;
    if (palette === 'standard') delete root.dataset.palette;
    else root.dataset.palette = palette;
    try {
        localStorage.setItem(PALETTE_KEY, palette);
    } catch {
        // Storage can be unavailable; the palette still applies to this page.
    }
    $('#public-palette').value = palette;
    if (changed) travelMap?.refreshTheme();
}

function printTitle() {
    const owner = state.user?.username || state.publicUser;
    const title = owner ? `${owner}'s travel map` : 'A sample TravelMapster map';
    const view = timelineView();
    if (!view) return title;
    return `${title}, ${view.mode === 'during' ? 'places visited during' : 'by the end of'} ${view.year}`;
}

// Printing shows a picture of the map as it is on screen (see the print styles). The evidence
// report prints on its own.
function preparePrint() {
    const image = $('#map-print');
    if (document.body.classList.contains('is-reporting') || image.getAttribute('src')) return;
    $('#print-title').textContent = printTitle();
    image.src = travelMap.snapshot();
}

async function printMap() {
    preparePrint();
    try {
        await $('#map-print').decode();
    } catch {
        // Print anyway: the browser waits for the picture or prints the page without it.
    }
    window.print();
}

function setupPrinting() {
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', () => $('#map-print').removeAttribute('src'));
    $('#print-btn').addEventListener('click', () => {
        closeAccountMenu();
        printMap();
    });
    $('#public-print').addEventListener('click', printMap);
    const select = $('#public-palette');
    select.replaceChildren(...PALETTES.map(palette => h('option', { value: palette.id }, palette.label)));
    select.value = paletteId(document.documentElement.dataset.palette);
    select.addEventListener('change', () => applyPalette(select.value));
}

// ---------------------------------------------------------------- day ledger

function currentLedger() {
    if (!state.ledger.overview) {
        state.ledger.overview = ledgerOverview({
            markers: state.markers,
            countryOf: marker => state.stats.markerCountry.get(marker.id),
            settings: state.ledger.settings,
            today: localToday(),
            nameOf: id => state.index.byId.get(id)?.name || id,
            formatDay: formatDate
        });
    }
    return state.ledger.overview;
}

function updateLedgerBadge() {
    const badge = $('#ledger-alert-count');
    const count = state.user ? currentLedger().alerts.length : 0;
    badge.hidden = !count;
    badge.querySelector('[aria-hidden]').textContent = count;
    badge.querySelector('.visually-hidden').textContent = ` (${count} ${count === 1 ? 'alert' : 'alerts'})`;
}

// In-app alerts: once per session, a nudge toward the Ledger tab.
function announceLedgerAlerts() {
    const { alerts } = currentLedger();
    if (state.ledger.alerted || !alerts.length) return;
    state.ledger.alerted = true;
    toast(alerts.length === 1 ? `Day ledger: ${alerts[0].message}` : `Day ledger: ${alerts.length} alerts need a look.`, {
        tone: 'error',
        duration: 8000,
        action: { label: 'Open ledger', run: () => selectTab('ledger') }
    });
}

async function saveLedger(settings) {
    state.ledger.settings = await api.saveLedger(settings);
    refresh({ celebrateNew: false });
}

let changesRequest = null;

/** The history of visit dates, fetched once after each change to places or visits. */
function loadVisitChanges() {
    if (state.ledger.changes) return Promise.resolve(state.ledger.changes);
    if (!changesRequest) {
        changesRequest = api.getVisitChanges()
            .then(changes => {
                state.ledger.changes = changes;
                return changes;
            })
            .finally(() => { changesRequest = null; });
    }
    return changesRequest;
}

async function reloadMarkers() {
    state.markers = await api.getMarkers();
    refresh();
}

// ---------------------------------------------------------------- saving places

// Demo places live only in the page, with negative ids like the sample traveler's.
let demoIds = -1000;

async function savePlace(place, { quiet = false } = {}) {
    const marker = state.demo
        ? { notes: '', photoUrl: '', visits: [], ...place, id: demoIds-- }
        : await api.addMarker(place);
    state.markers.push(marker);
    refresh();
    if (!quiet) {
        const verb = statusInfo(statusOf(place)).saved;
        toast(state.demo ? `${verb} ${place.name} on the demo map.` : `${verb} ${place.name}!`, { tone: 'success' });
    }
    return marker;
}

async function updatePlace(marker, changes) {
    const next = { ...marker, ...changes };
    if (!state.demo) await api.updateMarker(marker.id, next);
    Object.assign(marker, changes);
    refresh();
    return marker;
}

async function removePlace(marker) {
    if (!state.demo) await api.deleteMarker(marker.id);
    state.markers = state.markers.filter(item => item.id !== marker.id);
    refresh();
    toast(`Removed ${marker.name}.`, {
        action: {
            label: 'Undo',
            run: () => {
                const { id, ...place } = marker;
                savePlace(place, { quiet: true }).catch(error => toast(error.message, { tone: 'error' }));
            }
        }
    });
}

const STATUS_TOASTS = {
    visited: name => `${name}: been there! 🎉`,
    lived: name => `${name}: lived there! 🔑`,
    transit: name => `${name}: transit only, not counted as a visit.`,
    wishlist: name => `${name} moved to your wishlist.`
};

// Marks a country or city with a status (ADR 0014), toggling off when it already has it.
async function setStatus(existing, place, status) {
    try {
        if (existing && statusOf(existing) === status) {
            await removePlace(existing);
        } else if (existing) {
            await updatePlace(existing, statusFields(status));
            toast(STATUS_TOASTS[status](existing.name), { tone: 'success' });
        } else {
            await savePlace({ ...place, ...statusFields(status) });
        }
    } catch (error) {
        handleError(error);
    }
}

const RATING_OPTIONS = [
    { value: '', label: 'Not rated' },
    { value: '1', label: '★ 1 · Not for me' },
    { value: '2', label: '★★ 2 · It was OK' },
    { value: '3', label: '★★★ 3 · Good' },
    { value: '4', label: '★★★★ 4 · Great' },
    { value: '5', label: '★★★★★ 5 · Loved it' }
];

function placeFormFields(draft) {
    // The suggested tags and the traveler's most used ones, plus any this place already has.
    const tagOptions = [...new Set([...knownTags(state.markers).slice(0, 16), ...draft.tags])];
    return [
        { name: 'name', label: 'Name', value: draft.name, required: true, maxlength: 160 },
        { name: 'status', label: 'Status', type: 'select', value: draft.status || statusOf(draft),
            options: STATUSES.map(({ id }) => ({ value: id, label: statusLabel(id) })),
            hint: 'Transit only is for layovers: the country is not counted as visited, but dated days still count in the ledger.' },
        { name: 'priority', label: 'Wishlist priority', type: 'select', value: draft.priority || '',
            options: [{ value: '', label: 'No priority' }, ...PRIORITIES] },
        { name: 'bestMonths', label: 'Best months to go', type: 'choices', value: (draft.bestMonths || []).map(String),
            options: MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name.slice(0, 3) })),
            hint: 'The wishlist sorts places by the next of these months.' },
        { name: 'rating', label: 'Rating', type: 'select', value: draft.rating ? String(draft.rating) : '', options: RATING_OPTIONS },
        { name: 'emoji', label: 'Pin emoji', type: 'picker', value: draft.emoji || '', maxlength: 32, placeholder: 'Type or paste one emoji',
            choices: EMOJI_CHOICES, choicesLabel: 'Quick emoji', hint: 'Shown on the city pin and in your list.' },
        { name: 'tags', label: 'Tags', type: 'choices', value: draft.tags, options: tagOptions.map(tag => ({ value: tag, label: `#${tag}` })) },
        { name: 'otherTags', label: 'Other tags', value: draft.otherTags || '', maxlength: 200, placeholder: 'street art, road trip',
            hint: 'Separate tags with commas; at most 8 per place.' },
        { name: 'notes', label: 'Notes about this place', type: 'textarea', value: draft.notes || '', maxlength: 2000, placeholder: 'Why you love it, tips, what to try…' },
        { name: 'photoUrl', label: 'Photo link', type: 'url', value: draft.photoUrl || '', placeholder: 'https://…', hint: 'Link to a photo hosted anywhere (HTTP or HTTPS). Dates go on each visit.' },
        { name: 'hideFromPublic', label: 'Hide from my public map', type: 'checkbox', value: draft.hideFromPublic,
            hint: 'Visitors of your shared map will not see this place or its visits.' }
    ];
}

// A mistake reopens the form with what was typed, like the visit form.
async function editPlace(marker) {
    let draft = { ...marker, tags: marker.tags || [] };
    for (;;) {
        const values = await formDialog({ title: `Edit ${marker.name}`, submitLabel: 'Save changes', fields: placeFormFields(draft) });
        if (!values) return;
        const { details, error } = checkDetails({
            ...values, tags: [...values.tags, ...splitTags(values.otherTags)]
        });
        if (error) {
            toast(error, { tone: 'error' });
            draft = {
                ...draft, ...values, rating: parseRating(values.rating) ?? null, hideFromPublic: values.hideFromPublic === 'on',
                bestMonths: values.bestMonths.map(Number)
            };
            continue;
        }
        try {
            await updatePlace(marker, {
                name: values.name.trim(),
                ...statusFields(values.status),
                notes: values.notes.trim(),
                photoUrl: values.photoUrl.trim(),
                hideFromPublic: values.hideFromPublic === 'on',
                ...details
            });
            toast(`Saved ${marker.name}.`, { tone: 'success' });
            travelMap.closePopup();
        } catch (error) {
            handleError(error);
        }
        return;
    }
}

// ---------------------------------------------------------------- marking several countries

// Marks every country at once in one transactional request, with an undo that is one
// request too.
async function bulkMark(countries, type) {
    const { visitedIds, transitIds, homeId } = state.stats;
    const plan = planBulkMark({ countries, type, countryMarkerOf: countryMarker, visitedIds, transitIds, homeId });
    if (!plan.create.length && !plan.update.length) {
        toast(type === 'visited' ? 'Those countries are already colored in.' : 'Those countries are already on your wishlist or visited.');
        return false;
    }
    try {
        const result = await api.bulkMarkers(bulkRequest(plan));
        state.markers = applyBulkResult(state.markers, result);
        refresh();
        toast(bulkSummary(plan, type), { tone: 'success', action: { label: 'Undo', run: () => undoBulkMark(plan, result) } });
        return true;
    } catch (error) {
        handleError(error);
        return false;
    }
}

async function undoBulkMark(plan, result) {
    try {
        state.markers = applyBulkResult(state.markers, await api.bulkMarkers(undoRequest(plan, result)));
        refresh({ celebrateNew: false });
        toast('Undone: those countries are back as they were.');
    } catch (error) {
        handleError(error);
    }
}

function markContinent(continent, type) {
    return bulkMark(state.index.countries.filter(country => country.continent === continent), type);
}

function updateSelection() {
    const count = state.selection.size;
    $('#select-count').textContent = count
        ? `${count} ${count === 1 ? 'country' : 'countries'} selected`
        : 'Click countries on the map, or search for them, to select them.';
    for (const button of $all('#select-bar [data-bulk]')) button.disabled = !count;
    travelMap.setSelection(state.selection);
}

function startSelecting() {
    if (state.timeline.open) setTimelineOpen(false);
    state.selection = new Set();
    travelMap.closePopup();
    $('#select-bar').hidden = false;
    // On phones, tuck the bottom sheet away so the map is free to click.
    if (window.innerWidth <= 760) {
        $('#panel').classList.add('is-collapsed');
        $('#panel-handle').setAttribute('aria-expanded', 'false');
    }
    updateSelection();
    $('#select-cancel').focus();
}

function stopSelecting() {
    if (!state.selection) return;
    const hadFocus = $('#select-bar').contains(document.activeElement);
    state.selection = null;
    $('#select-bar').hidden = true;
    travelMap.setSelection([]);
    // Keyboard users go back to where they started picking.
    if (hadFocus) ($('#bulk-pick') || $('#panel')).focus();
}

function toggleSelected(country) {
    if (!country) return;
    if (state.selection.has(country.id)) state.selection.delete(country.id);
    else state.selection.add(country.id);
    updateSelection();
}

function setupSelectBar() {
    for (const button of $all('#select-bar [data-bulk]')) {
        button.addEventListener('click', async () => {
            const countries = [...state.selection].map(id => state.index.byId.get(id));
            if (await bulkMark(countries, button.dataset.bulk)) stopSelecting();
        });
    }
    $('#select-cancel').addEventListener('click', stopSelecting);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.selection && !document.querySelector('dialog[open]')) stopSelecting();
    });
}

// ---------------------------------------------------------------- visits

function setVisits(marker, visits) {
    marker.visits = sortVisits(visits);
    marker.travelDate = lastVisitDate(marker);
    refresh();
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

async function addVisit(marker) {
    const values = await visitDialog(marker);
    if (!values) return;
    try {
        const visit = await api.addVisit(marker.id, values);
        setVisits(marker, [...marker.visits, visit]);
        toast(`${visitCountLabel(marker.visits.length, statusOf(marker))}: ${marker.name}!`, { tone: 'success' });
    } catch (error) {
        handleError(error);
    }
}

async function editVisit(marker, visit) {
    const values = await visitDialog(marker, visit);
    if (!values) return;
    try {
        const updated = await api.updateVisit(visit.id, values);
        setVisits(marker, marker.visits.map(item => (item.id === visit.id ? updated : item)));
        toast('Visit saved.', { tone: 'success' });
    } catch (error) {
        handleError(error);
    }
}

async function removeVisit(marker, visit) {
    try {
        await api.deleteVisit(visit.id);
        setVisits(marker, marker.visits.filter(item => item.id !== visit.id));
        toast(`Removed the visit of ${formatDate(visit.startDate)}.`, {
            action: {
                label: 'Undo',
                run: () => {
                    const { id, ...restored } = visit;
                    api.addVisit(marker.id, restored)
                        .then(added => setVisits(marker, [...marker.visits, added]))
                        .catch(handleError);
                }
            }
        });
    } catch (error) {
        handleError(error);
    }
}

function handleError(error) {
    if (error.status === 401) {
        toast('Your session expired. Please log in again.', { tone: 'error' });
        showSignedOut();
        return;
    }
    toast(error.message || 'Something went wrong.', { tone: 'error' });
}

// ---------------------------------------------------------------- map cards

function statusChip(status) {
    if (status === 'home') return h('span', { class: 'chip chip-home' }, `${HOME.icon} ${HOME.label}`);
    if (!status) return h('span', { class: 'chip' }, 'Not yet');
    return h('span', { class: `chip chip-${status}` }, statusLabel(status));
}

function statusButtons(existing, place) {
    if (state.publicUser) return null;
    if (!state.user && !state.demo) return h('p', { class: 'card-note' }, 'Log in to color this in on your map.');
    const current = existing ? statusOf(existing) : null;
    const button = ({ id }) => h('button', {
        type: 'button',
        class: `btn btn-sm btn-${id}${current === id ? ' is-active' : ''}`,
        'aria-pressed': String(current === id),
        onclick: async () => {
            await setStatus(existing, place, id);
            reopenCard();
        }
    }, statusLabel(id));
    return [
        h('div', { class: 'card-actions' }, STATUSES.map(button)),
        state.demo ? h('p', { class: 'card-note' }, 'Demo map: nothing is saved. Sign up to keep your own.') : null
    ];
}

function visitItem(marker, visit) {
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
        state.user ? h('div', { class: 'visit-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit the visit of ${dates}`, title: 'Edit visit', onclick: () => editVisit(marker, visit) }, '✏️'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove the visit of ${dates}`, title: 'Remove visit', onclick: () => removeVisit(marker, visit) }, '🗑️')
        ) : null
    );
}

const ADD_VISIT_LABELS = { lived: '＋ Add the dates you lived here', transit: '＋ Add a layover' };

// Visits newest first, with how many times you have been; wishlist places show them
// only once they have one. Dates where the traveler lived or changed planes are visits too,
// so the day ledger counts them (ADR 0014).
function visitsSection(marker) {
    const visits = sortVisits(marker.visits);
    const status = statusOf(marker);
    if (status === 'wishlist' && !visits.length) return null;
    const headingId = `visits-heading-${marker.id}`;
    return h('section', { class: 'card-visits', 'aria-labelledby': headingId },
        h('h4', { id: headingId, class: 'visits-title' }, visitCountLabel(visits.length, status)),
        visits.length ? h('ol', { class: 'visit-list' }, visits.map(visit => visitItem(marker, visit))) : null,
        state.user ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost visit-add', onclick: () => addVisit(marker) },
            ADD_VISIT_LABELS[status] || '＋ Add a visit') : null
    );
}

// Rating, emoji, tags and wishlist plans of a saved place, shown when it has any.
function detailsRow(marker) {
    const tags = marker.tags || [];
    const months = marker.type === 'wishlist' ? monthsLabel(marker.bestMonths) : '';
    const priority = marker.type === 'wishlist' ? priorityLabel(marker.priority) : '';
    if (!marker.rating && !marker.emoji && !tags.length && !months && !priority) return null;
    return h('div', { class: 'card-details' },
        priority ? h('span', { class: 'chip chip-wishlist' }, priority) : null,
        months ? h('span', { class: 'card-months' }, h('span', { 'aria-hidden': 'true' }, '📅 '), `Best ${months}`) : null,
        marker.emoji ? h('span', { class: 'card-emoji', title: 'Pin emoji' }, marker.emoji) : null,
        marker.rating ? h('span', { class: 'stars' },
            h('span', { 'aria-hidden': 'true' }, stars(marker.rating)),
            h('span', { class: 'visually-hidden' }, ratingLabel(marker.rating))) : null,
        tags.length ? h('ul', { class: 'tag-list', 'aria-label': 'Tags' }, tags.map(tag => h('li', { class: 'tag' }, `#${tag}`))) : null
    );
}

function savedDetails(marker) {
    if (!marker) return null;
    return h('div', { class: 'card-saved' },
        detailsRow(marker),
        visitsSection(marker),
        marker.notes ? h('p', { class: 'card-notes' }, marker.notes) : null,
        marker.photoUrl ? h('a', { href: marker.photoUrl, target: '_blank', rel: 'noopener noreferrer', class: 'card-photo' },
            h('img', { src: marker.photoUrl, alt: `Photo of ${marker.name}`, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: event => event.target.replaceWith('📷 View photo') })
        ) : null,
        state.user && marker.hideFromPublic ? h('p', { class: 'card-note' }, h('span', { 'aria-hidden': 'true' }, '🔒 '), 'Hidden from your public map') : null,
        state.user ? h('div', { class: 'card-links' },
            h('button', { type: 'button', class: 'link-btn', onclick: () => editPlace(marker) }, '✏️ Edit details'),
            h('button', { type: 'button', class: 'link-btn danger', onclick: () => { travelMap.closePopup(); removePlace(marker).catch(handleError); } }, '🗑️ Remove')
        ) : null
    );
}

function ideaButtons(destination) {
    return h('div', { class: 'card-links' },
        h('button', { type: 'button', class: 'link-btn', onclick: () => showIdeas(destination) }, '💡 Travel ideas'),
        state.user ? h('button', { type: 'button', class: 'link-btn', onclick: () => { travelMap.closePopup(); openNewTrip(context, destination); } }, '🗓️ Plan a trip') : null
    );
}

let lastCard = null;

function reopenCard() {
    if (lastCard) lastCard();
}

// A country saved through a city takes the city's status; the note says so.
const DERIVED_NOTES = { visited: 'via a city you visited', lived: 'via a city you lived in', transit: 'via a city you passed through' };
const LOOK_STATUS = { cityOnly: 'visited', visited: 'visited', lived: 'lived', transit: 'transit' };

function countryStatusRow(country, existing) {
    const isHome = state.stats?.homeId === country.id;
    const cities = existing ? [] : markersForCountry(country);
    const derived = cities.length
        ? LOOK_STATUS[countryLook(country.id, countryStatus(cities, marker => state.stats.markerCountry.get(marker.id)))]
        : null;
    return h('div', { class: 'card-status' },
        isHome ? statusChip('home') : null,
        existing || derived || !isHome ? statusChip(existing ? statusOf(existing) : derived) : null,
        derived ? h('small', { class: 'muted' }, DERIVED_NOTES[derived]) : null);
}

// Saves account settings and recounts the map and passport with them.
async function saveSettings(changes, message) {
    try {
        const profile = await api.saveProfile(changes);
        Object.assign(state.user, profile);
        if (profile.mapPalette) applyPalette(profile.mapPalette);
        refresh();
        toast(message, { tone: 'success' });
    } catch (error) {
        handleError(error);
    }
}

function setHomeCountry(country) {
    return saveSettings({ homeCountry: country?.id || null },
        country ? `${country.name} is your home country. 🏠` : 'Home country cleared.');
}

// Signed-in travelers set their home country from its card, or in the settings.
function homeButton(country) {
    if (!state.user) return null;
    const isHome = state.user.homeCountry === country.id;
    return h('div', { class: 'card-links' }, h('button', {
        type: 'button',
        class: 'link-btn',
        onclick: async () => {
            await setHomeCountry(isHome ? null : country);
            reopenCard();
        }
    }, isHome ? '🏠 Not my home country any more' : '🏠 Make this my home country'));
}

function showCountryCard(country, latlng) {
    lastCard = () => showCountryCard(country, latlng);
    const existing = countryMarker(country);
    const capital = capitalOf(country);
    const cities = markersForCountry(country).filter(marker => marker.category === 'City');
    const place = { lat: country.label[0], lng: country.label[1], name: country.name, category: 'Country' };

    const card = h('article', { class: 'card' },
        h('header', { class: 'card-header' },
            h('span', { class: 'card-flag', 'aria-hidden': 'true' }, country.flag),
            h('div', {},
                h('h3', {}, country.name),
                h('p', { class: 'card-sub' }, `${CONTINENT_EMOJI[country.continent] || ''} ${country.subregion || country.continent}`)
            )
        ),
        countryStatusRow(country, existing),
        h('dl', { class: 'card-facts' },
            capital ? [h('dt', {}, 'Capital'), h('dd', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => showCityCard(capital) }, `★ ${capital.name}`))] : null,
            h('dt', {}, 'Population'), h('dd', {}, formatPopulation(country.population))
        ),
        cities.length ? h('div', { class: 'card-cities' },
            h('p', { class: 'muted small' }, 'Your cities here'),
            h('div', { class: 'chip-row' }, cities.map(marker => h('button', {
                type: 'button',
                class: `chip chip-${statusOf(marker)}`,
                onclick: () => showSavedCityCard(marker)
            }, marker.name.split(',')[0])))
        ) : null,
        statusButtons(existing, place),
        savedDetails(existing),
        homeButton(country),
        ideaButtons(country.name)
    );
    travelMap.openPopup(latlng || country.label, card);
    travelMap.pulseCountry(country.id);
}

function showCityCard(city) {
    lastCard = () => showCityCard(city);
    const existing = cityMarkerFor(city);
    const country = state.index.byId.get(city.countryId);
    const place = { lat: city.lat, lng: city.lng, name: `${city.name}, ${city.country}`, category: 'City' };
    const card = h('article', { class: 'card' },
        h('header', { class: 'card-header' },
            h('span', { class: 'card-flag', 'aria-hidden': 'true' }, country?.flag || '📍'),
            h('div', {},
                h('h3', {}, city.name),
                h('p', { class: 'card-sub' },
                    country ? h('button', { type: 'button', class: 'link-btn', onclick: () => showCountryCard(country) }, city.country) : city.country,
                    city.capital ? ' · ★ Capital' : '')
            )
        ),
        h('div', { class: 'card-status' }, statusChip(existing ? statusOf(existing) : null)),
        h('dl', { class: 'card-facts' }, h('dt', {}, 'Population'), h('dd', {}, formatPopulation(city.population))),
        statusButtons(existing, place),
        savedDetails(existing),
        ideaButtons(city.name)
    );
    travelMap.openPopup([city.lat, city.lng], card, { offset: [0, -4] });
}

function showSavedCityCard(marker) {
    lastCard = () => {
        const current = state.markers.find(item => item.id === marker.id);
        if (current) showSavedCityCard(current);
        else travelMap.closePopup();
    };
    const country = state.stats?.markerCountry.get(marker.id);
    const [cityName] = marker.name.split(',');
    const place = { lat: marker.lat, lng: marker.lng, name: marker.name, category: 'City' };
    const card = h('article', { class: 'card' },
        h('header', { class: 'card-header' },
            h('span', { class: 'card-flag', 'aria-hidden': 'true' }, country?.flag || '📍'),
            h('div', {},
                h('h3', {}, cityName),
                h('p', { class: 'card-sub' }, country
                    ? h('button', { type: 'button', class: 'link-btn', onclick: () => showCountryCard(country) }, country.name)
                    : marker.name)
            )
        ),
        h('div', { class: 'card-status' }, statusChip(statusOf(marker))),
        statusButtons(marker, place),
        savedDetails(marker),
        ideaButtons(cityName)
    );
    travelMap.openPopup([marker.lat, marker.lng], card, { offset: [0, -30] });
}

function showMarker(marker) {
    if (marker.category === 'City') {
        travelMap.flyTo(marker.lat, marker.lng, 5.5).then(() => showSavedCityCard(marker));
        return;
    }
    const country = state.stats?.markerCountry.get(marker.id);
    if (country) {
        travelMap.flyToCountry(country).then(() => showCountryCard(country));
    }
}

// ---------------------------------------------------------------- search

const search = {
    input: null,
    list: null,
    results: [],
    active: -1
};

function searchResults(query, cities = searchCities(state.cities, query, 6)) {
    const countries = state.index.search(query, 5).map(country => ({ kind: 'country', country }));
    const results = [...countries, ...cities.map(city => ({ kind: 'city', city }))];
    if (query.trim().length >= 3) results.push({ kind: 'world', query: query.trim() });
    return results;
}

// Big cities are matched instantly in the browser; every smaller town comes from the
// server's index a moment later, replacing the city results if the query is unchanged.
let placeSearchTimer = 0;
function searchAllPlaces(query) {
    clearTimeout(placeSearchTimer);
    if (query.trim().length < 2) return;
    placeSearchTimer = setTimeout(async () => {
        try {
            const cities = await api.searchPlaces(query.trim());
            if (search.input.value !== query || !cities.length) return;
            search.results = searchResults(query, cities);
            search.active = Math.min(Math.max(search.active, 0), search.results.length - 1);
            renderSearchResults();
        } catch {
            // The instant results stay; the world search remains available.
        }
    }, 150);
}

function renderSearchResults() {
    const { list, results } = search;
    list.replaceChildren(...results.map((result, i) => {
        let content;
        if (result.kind === 'country') {
            content = [h('span', { class: 'result-icon' }, result.country.flag), h('span', {}, result.country.name), h('small', {}, result.country.continent)];
        } else if (result.kind === 'city') {
            content = [h('span', { class: 'result-icon' }, result.city.capital ? '★' : '●'), h('span', {}, result.city.name), h('small', {}, result.city.country)];
        } else {
            content = [h('span', { class: 'result-icon' }, '🌐'), h('span', {}, `Search the world for “${result.query}”`)];
        }
        return h('li', {
            id: `search-result-${i}`,
            role: 'option',
            class: i === search.active ? 'is-active' : '',
            'aria-selected': String(i === search.active),
            onmousedown: event => {
                event.preventDefault();
                chooseResult(result);
            }
        }, content);
    }));
    list.hidden = results.length === 0;
    search.input.setAttribute('aria-expanded', String(!list.hidden));
    search.input.setAttribute('aria-activedescendant', search.active >= 0 ? `search-result-${search.active}` : '');
}

async function searchWorld(query) {
    // The server-side geocoder covers towns that are not in the built-in city list.
    const [result] = await api.geocodeCity(query);
    if (!result) throw new Error(`No place called “${query}” was found.`);
    const name = result.city || result.name || query;
    const lat = Number(result.lat);
    const lng = Number(result.lng);
    const country = state.index.findAt(lat, lng);
    return {
        name,
        country: country?.name || result.country || '',
        countryId: country?.id || '',
        capital: 0,
        population: 0,
        lat: Math.round(lat * 100) / 100,
        lng: Math.round(lng * 100) / 100
    };
}

async function chooseResult(result) {
    search.input.value = '';
    search.results = [];
    search.active = -1;
    renderSearchResults();
    search.input.blur();

    // While picking countries, a search result picks its country.
    if (state.selection && result.kind !== 'world') {
        const country = result.kind === 'country' ? result.country : state.index.byId.get(result.city.countryId);
        toggleSelected(country);
        if (country) travelMap.flyToCountry(country);
        return;
    }
    if (result.kind === 'country') {
        travelMap.flyToCountry(result.country).then(() => showCountryCard(result.country));
    } else if (result.kind === 'city') {
        // Fly close enough for the town to be drawn on the map.
        const zoom = Math.min(11, Math.max(5.5, (result.city.minZoom ?? 5) + 0.5));
        travelMap.flyTo(result.city.lat, result.city.lng, zoom).then(() => showCityCard(result.city));
    } else {
        try {
            const city = await searchWorld(result.query);
            travelMap.flyTo(city.lat, city.lng, 6).then(() => showCityCard(city));
        } catch (error) {
            toast(error.message, { tone: 'error' });
        }
    }
}

function setupSearch() {
    search.input = $('#global-search');
    search.list = $('#search-results');
    search.input.addEventListener('input', () => {
        search.results = searchResults(search.input.value);
        search.active = search.results.length ? 0 : -1;
        renderSearchResults();
        searchAllPlaces(search.input.value);
    });
    search.input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!search.results.length) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            search.active = (search.active + step + search.results.length) % search.results.length;
            renderSearchResults();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const result = search.results[search.active];
            if (result) chooseResult(result);
        } else if (event.key === 'Escape') {
            search.input.value = '';
            search.results = [];
            renderSearchResults();
        }
    });
    search.input.addEventListener('blur', () => {
        setTimeout(() => {
            search.list.hidden = true;
            search.input.setAttribute('aria-expanded', 'false');
        }, 100);
    });
    document.addEventListener('keydown', event => {
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
        if (event.key === '/' && !typing) {
            event.preventDefault();
            search.input.focus();
        }
    });
}

// ---------------------------------------------------------------- surprise me

function surprise() {
    const visited = state.stats?.visitedIds || new Set();
    const wishlist = state.stats?.wishlistIds || new Set();
    const bigEnough = state.index.countries.filter(country => country.population > 200000);
    const wished = bigEnough.filter(country => wishlist.has(country.id));
    const unvisited = bigEnough.filter(country => !visited.has(country.id));
    // Half the time, nudge toward a wishlist dream.
    const pool = wished.length && Math.random() < 0.5 ? wished : unvisited.length ? unvisited : bigEnough;
    const country = pool[Math.floor(Math.random() * pool.length)];
    travelMap.flyToCountry(country).then(() => showCountryCard(country));
}

// ---------------------------------------------------------------- ideas

async function showIdeas(destination) {
    travelMap.closePopup();
    if (!state.user) {
        state.ideas = { destination, loading: true };
        renderIdeasInto(signedOutContainer(), true);
    } else {
        selectTab('explore');
        state.ideas = { destination, loading: true };
        renderActiveTab();
    }
    try {
        const ideas = await fetchIdeas(destination);
        if (state.ideas?.destination !== destination) return;
        state.ideas = { destination, ideas };
    } catch (error) {
        if (state.ideas?.destination !== destination) return;
        state.ideas = { destination, error: error.message || 'Could not load travel ideas.' };
    }
    if (state.user) renderActiveTab();
    else renderIdeasInto(signedOutContainer(), true);
}

function signedOutContainer() {
    return state.publicUser ? $('#public-view') : $('#welcome-view');
}

function ideasSection() {
    const { destination, ideas, loading, error } = state.ideas;
    const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close ideas', onclick: () => {
        state.ideas = null;
        $('.ideas-standalone')?.remove();
        renderActiveTab();
    } }, '✕');
    const header = h('div', { class: 'section-head' }, h('h2', {}, `💡 Ideas for ${destination}`), close);
    if (loading) return h('section', { class: 'ideas' }, header, h('p', { class: 'muted' }, 'Flipping through the guidebook…'));
    if (error) return h('section', { class: 'ideas' }, header, h('p', { class: 'form-error' }, error));

    const group = (title, icon, items) => items?.length ? h('div', { class: 'idea-group' },
        h('h3', {}, `${icon} ${title}`),
        h('ul', {}, items.slice(0, 6).map(item => h('li', {}, h('strong', {}, item.name), item.description ? h('span', {}, ` ${item.description}`) : null)))
    ) : null;

    const hasAny = ['see', 'do', 'eat', 'drink', 'destinations', 'related'].some(key => ideas[key]?.length);
    return h('section', { class: 'ideas' },
        header,
        ideas.summary ? h('p', { class: 'ideas-summary' }, ideas.summary) : null,
        group('Places to go', '🗺️', ideas.destinations),
        group('See', '👀', ideas.see),
        group('Do', '🎒', ideas.do),
        group('Eat', '🍜', ideas.eat),
        group('Drink', '🍹', ideas.drink),
        group('Related guides', '📚', ideas.related),
        hasAny ? null : h('p', { class: 'muted' }, 'No highlights found in the guide yet.'),
        h('div', { class: 'ideas-actions' },
            h('a', { class: 'btn btn-ghost btn-sm', href: ideas.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open full guide ↗'),
            state.user ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openNewTrip(context, destination) }, '🗓️ Plan a trip') : null
        ),
        h('p', { class: 'attribution' }, 'Travel content from ', h('a', { href: 'https://en.wikivoyage.org', target: '_blank', rel: 'noopener noreferrer' }, 'Wikivoyage'), ' (CC BY-SA).')
    );
}

function renderIdeasInto(container, standalone) {
    container.querySelector('.ideas-standalone')?.remove();
    if (!state.ideas) return;
    const wrapper = h('div', { class: standalone ? 'ideas-standalone' : '' }, ideasSection());
    container.prepend(wrapper);
}

// ---------------------------------------------------------------- explore tab

function renderExplore(container) {
    const stats = state.stats;
    const recent = [...state.markers].sort((a, b) => b.id - a.id).slice(0, 4);
    const wishlist = state.markers.filter(marker => marker.type === 'wishlist');
    // The wishlist place in season soonest, or a different dream every day.
    const month = new Date().getMonth() + 1;
    const nextDream = nextInSeason(wishlist, month) || wishlist[Math.floor(Date.now() / 86400000) % Math.max(wishlist.length, 1)];

    fill(container,
        state.ideas ? ideasSection() : null,
        h('section', { class: 'greeting' },
            h('p', { class: 'eyebrow' }, stats.rank.title),
            h('h2', {}, `Hi ${state.user.username}! `, h('span', { 'aria-hidden': 'true' }, '👋')),
            h('p', { class: 'muted' }, stats.visitedCountries
                ? `You've colored in ${stats.visitedCountries} ${stats.visitedCountries === 1 ? 'country' : 'countries'}, ${stats.worldPercent}% ${shareLabel(stats.countryList)}.`
                : 'Click any country you have visited to color it in.')
        ),
        state.markers.length === 0 ? h('section', { class: 'onboarding' },
            h('h3', {}, 'Get started in three taps'),
            h('ol', {},
                h('li', {}, 'Click a country on the map.'),
                h('li', {}, 'Press ', h('strong', {}, '✓ Been there'), ' or ', h('strong', {}, '♥ Wishlist'), '.'),
                h('li', {}, 'Zoom in and pin the cities you loved.')
            )
        ) : null,
        nextDream ? h('section', { class: 'dream-card' },
            h('p', { class: 'eyebrow' }, 'Your next adventure?'),
            h('h3', {}, nextDream.emoji ? `${nextDream.emoji} ` : '', nextDream.name),
            nextDream.bestMonths?.length ? h('p', { class: 'small' }, `Best ${monthsLabel(nextDream.bestMonths)}`,
                nextDream.priority ? ` · ${priorityLabel(nextDream.priority)}` : '') : null,
            h('div', { class: 'row' },
                h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => showMarker(nextDream) }, 'Show on map'),
                h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => openNewTrip(context, nextDream.name.split(',')[0]) }, 'Plan it')
            )
        ) : null,
        h('section', {},
            h('h3', { class: 'section-title' }, 'Jump to a continent'),
            h('div', { class: 'continent-grid' }, CONTINENTS.map(name => {
                const continent = stats.continents.find(item => item.name === name);
                return h('button', { type: 'button', class: 'continent-btn', onclick: () => flyToContinent(name) },
                    h('span', { class: 'continent-emoji', 'aria-hidden': 'true' }, CONTINENT_EMOJI[name]),
                    h('span', {}, name),
                    h('small', {}, `${continent.visited}/${continent.total}`)
                );
            }))
        ),
        recent.length ? h('section', {},
            h('h3', { class: 'section-title' }, 'Recently added'),
            h('ul', { class: 'mini-list' }, recent.map(marker => {
                const country = stats.markerCountry.get(marker.id);
                return h('li', {}, h('button', { type: 'button', onclick: () => showMarker(marker) },
                    h('span', { 'aria-hidden': 'true' }, country?.flag || '📍'),
                    h('span', {}, marker.name),
                    statusChip(statusOf(marker))
                ));
            }))
        ) : null,
        h('p', { class: 'muted small tip' }, 'Tip: press ', h('kbd', {}, '/'), ' to search, zoom in to see more cities.')
    );
}

const CONTINENT_VIEWS = {
    Africa: [[2, 20], 3],
    Asia: [[34, 90], 2.5],
    Europe: [[52, 15], 3.5],
    'North America': [[45, -100], 2.5],
    Oceania: [[-22, 145], 3],
    'South America': [[-18, -60], 3]
};

function flyToContinent(name) {
    const [center, zoom] = CONTINENT_VIEWS[name];
    travelMap.flyToView(center, zoom);
}

// ---------------------------------------------------------------- tabs

const TAB_RENDERERS = {
    explore: container => renderExplore(container),
    places: container => renderPlaces(container, context),
    trips: container => renderTrips(container, context),
    ledger: container => renderLedger(container, context),
    passport: container => renderPassport(container, context)
};

function selectTab(name) {
    state.activeTab = name;
    for (const tab of $all('.tabs [role="tab"]')) {
        const selected = tab.id === `tab-${name}`;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
    }
    try {
        localStorage.setItem('travelmapster.tab', name);
    } catch {
        // Storage can be unavailable (private mode); the tab just won't be remembered.
    }
    renderActiveTab();
}

function renderActiveTab() {
    if (!state.user || !state.stats) return;
    const container = $(`#${state.activeTab}-tab`);
    const scroll = $('#panel').scrollTop;
    // A filter that re-renders its own tab keeps the keyboard focus on it.
    const focusedId = container.contains(document.activeElement) ? document.activeElement.id : '';
    TAB_RENDERERS[state.activeTab](container);
    if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    $('#panel').scrollTop = scroll;
}

function setupTabs() {
    const tabs = $all('.tabs [role="tab"]');
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab.id.replace('tab-', '')));
        tab.addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            next.focus();
            selectTab(next.id.replace('tab-', ''));
        });
    });
}

// ---------------------------------------------------------------- landing

// The ledger story counts the sample traveler's Schengen days live, as the Ledger tab would.
function renderDemoLedger() {
    const schengen = currentLedger().stays.find(item => item.rule.id === SCHENGEN_RULE.id);
    fill($('#demo-ledger'),
        h('span', { 'aria-hidden': 'true' }, '🧮 '),
        'The sample traveler is in Lisbon and has used ',
        h('strong', {}, `${schengen.used} of 90`),
        ' Schengen days, so ',
        h('strong', {}, `${schengen.remaining} days`),
        ' are left today.'
    );
}

// "Sign up" and "Log in" on the landing page, and links from other pages to /#sign-up or
// /#log-in, open the account form in that mode.
function openAuth(mode) {
    setAuthMode(mode);
    $('#account-start').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#auth-username').focus({ preventScroll: true });
}

function setupLanding() {
    for (const button of $all('[data-auth-mode]')) {
        button.addEventListener('click', () => openAuth(button.dataset.authMode));
    }
}

const AUTH_HASHES = { '#sign-up': 'register', '#log-in': 'login' };

// ---------------------------------------------------------------- auth

let authMode = 'login';

function setAuthMode(mode) {
    authMode = mode;
    $('#tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('#tab-register').setAttribute('aria-selected', String(mode === 'register'));
    $('#auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create my map';
    $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-hint').hidden = mode === 'login';
    $('#auth-error').hidden = true;
}

function setupAuth() {
    $('#tab-login').addEventListener('click', () => setAuthMode('login'));
    $('#tab-register').addEventListener('click', () => setAuthMode('register'));
    setAuthMode('login');

    $('#auth-form').addEventListener('submit', async event => {
        event.preventDefault();
        const username = $('#auth-username').value.trim();
        const password = $('#auth-password').value;
        const errorBox = $('#auth-error');
        errorBox.hidden = true;
        if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
            errorBox.textContent = 'Usernames need 3 to 32 letters, digits, dots, dashes or underscores, and passwords 8+ characters.';
            errorBox.hidden = false;
            return;
        }
        const submit = $('#auth-submit');
        submit.disabled = true;
        try {
            if (authMode === 'register') {
                await api.register(username, password);
            }
            await api.login(username, password);
            $('#auth-password').value = '';
            if (AUTH_HASHES[location.hash]) history.replaceState(null, '', location.pathname + location.search);
            await startSession();
            toast(authMode === 'register' ? 'Welcome aboard! Your map is ready. 🗺️' : `Welcome back, ${username}!`, { tone: 'success' });
        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
        } finally {
            submit.disabled = false;
        }
    });

    $('#logout-btn').addEventListener('click', async () => {
        try {
            await api.logout();
        } catch {
            // Logging out locally is still the right outcome.
        }
        closeAccountMenu();
        showSignedOut();
        toast('See you on your next trip! ✈️');
    });
}

// Account settings that change how the map and passport count (ADR 0014, 0015).
async function openSettings() {
    const countries = [...state.index.countries].sort((a, b) => a.name.localeCompare(b.name));
    const values = await formDialog({
        title: 'Settings',
        submitLabel: 'Save settings',
        fields: [
            { name: 'homeCountry', label: 'Home country', type: 'select', value: state.user.homeCountry || '',
                options: [{ value: '', label: 'No home country' }, ...countries.map(country => ({ value: country.id, label: `${country.flag} ${country.name}` }))],
                hint: 'Shown with its own color and counted as a country you have been to and lived in. It is never shown on your public map.' },
            { name: 'countryList', label: 'Count countries from', type: 'select', value: state.user.countryList || 'all',
                options: COUNTRY_LISTS.map(list => ({ value: list.id, label: `${list.label} (${countedCountries(state.index, list.id).length})` })),
                hint: 'Your passport, ranks and share of the world count only this list; the map still colors in every '
                    + 'territory. Places such as Kosovo, Taiwan or Greenland are not UN members or observers, so they count '
                    + 'only on the full list.' },
            { name: 'mapPalette', label: 'Map colors', type: 'select', value: paletteId(state.user.mapPalette),
                options: PALETTES.map(palette => ({ value: palette.id, label: palette.label })),
                hint: 'Color-blind safe colors keep every status apart for all kinds of color vision; print-friendly colors '
                    + 'suit paper and grayscale printers. Patterns and outlines stay the same.' },
            { name: 'publicJourneys', label: 'Show journey lines on my public map', type: 'checkbox', value: state.user.publicJourneys,
                hint: 'Visitors already see your visit dates; with this on, the timeline also draws the order you traveled in.' }
        ]
    });
    if (!values) return;
    const changes = {};
    if ((values.homeCountry || null) !== (state.user.homeCountry || null)) changes.homeCountry = values.homeCountry || null;
    if (values.countryList !== (state.user.countryList || 'all')) changes.countryList = values.countryList;
    if (values.mapPalette !== paletteId(state.user.mapPalette)) changes.mapPalette = values.mapPalette;
    if ((values.publicJourneys === 'on') !== Boolean(state.user.publicJourneys)) changes.publicJourneys = values.publicJourneys === 'on';
    if (!Object.keys(changes).length) return;
    await saveSettings(changes, 'Settings saved.');
}

function shareUrl() {
    return `${location.origin}/?u=${encodeURIComponent(state.user.username)}`;
}

function closeAccountMenu() {
    $('#account-menu').hidden = true;
    $('#account-btn').setAttribute('aria-expanded', 'false');
}

function setupAccountMenu() {
    const button = $('#account-btn');
    const menu = $('#account-menu');
    button.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', event => {
        if (!menu.hidden && !$('#account').contains(event.target)) closeAccountMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) {
            closeAccountMenu();
            button.focus();
        }
    });

    $('#public-toggle').addEventListener('change', async event => {
        const visibility = event.target.checked ? 'public' : 'private';
        try {
            await api.saveProfile({ profileVisibility: visibility });
            state.user.profileVisibility = visibility;
            $('#copy-share-btn').disabled = visibility !== 'public';
            toast(visibility === 'public' ? 'Your map is public. Share the link!' : 'Your map is private again.', { tone: 'success' });
        } catch (error) {
            event.target.checked = !event.target.checked;
            handleError(error);
        }
    });

    $('#settings-btn').addEventListener('click', async () => {
        closeAccountMenu();
        await openSettings();
    });

    $('#password-btn').addEventListener('click', async () => {
        closeAccountMenu();
        const values = await formDialog({
            title: 'Change password',
            message: 'Other devices will be signed out.',
            submitLabel: 'Change password',
            fields: [
                { name: 'currentPassword', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
                { name: 'newPassword', label: 'New password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password', hint: 'At least 8 characters.' },
                { name: 'confirmPassword', label: 'Repeat new password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }
            ]
        });
        if (!values) return;
        if (values.newPassword !== values.confirmPassword) {
            toast('The new passwords do not match.', { tone: 'error' });
            return;
        }
        try {
            await api.changePassword(values.currentPassword, values.newPassword);
            toast('Password changed.', { tone: 'success' });
        } catch (error) {
            handleError(error);
        }
    });

    $('#delete-account-btn').addEventListener('click', async () => {
        closeAccountMenu();
        const values = await formDialog({
            title: 'Delete your account?',
            message: 'Your places, trips, day ledger and passport are deleted for good. Export your places first if you want to keep them.',
            submitLabel: 'Delete account',
            danger: true,
            fields: [{ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' }]
        });
        if (!values) return;
        try {
            await api.deleteAccount(values.password);
            showSignedOut();
            toast('Your account and travel data were deleted.');
        } catch (error) {
            handleError(error);
        }
    });

    $('#copy-share-btn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(shareUrl());
            toast('Share link copied!', { tone: 'success' });
        } catch {
            toast(`Share link: ${shareUrl()}`);
        }
    });
}

function setView(name) {
    for (const view of ['welcome', 'main', 'public', 'loading']) {
        $(`#${view}-view`).hidden = view !== name;
    }
    $('#app').dataset.state = name;
}

function showSignedOut() {
    state.user = null;
    state.demo = true;
    state.markers = demoMarkers(localToday());
    state.trips = [];
    state.unlocked = null;
    state.ideas = null;
    state.ledger = { settings: { dayRule: 'presence', rules: [], planned: [] }, changes: null, overview: null, alerted: false };
    $('#account').hidden = true;
    stopSelecting();
    setTimelineOpen(false);
    travelMap.closePopup();
    refresh({ celebrateNew: false });
    setView('welcome');
    if (AUTH_HASHES[location.hash]) openAuth(AUTH_HASHES[location.hash]);
}

async function startSession() {
    const user = await api.currentUser();
    state.user = user;
    state.demo = false;
    setTimelineOpen(false);
    // A replica of the previous release sends no palette: keep this browser's.
    if (user.mapPalette) applyPalette(user.mapPalette);
    travelMap.closePopup();
    $('#account').hidden = false;
    $('#account-name').textContent = user.username;
    $('#avatar-initial').textContent = user.username.slice(0, 1).toUpperCase();
    $('#public-toggle').checked = user.profileVisibility === 'public';
    $('#copy-share-btn').disabled = user.profileVisibility !== 'public';

    // A replica of the previous release has no ledger yet during a rollout: start with the defaults.
    const [markers, trips, ledgerSettings] = await Promise.all([
        api.getMarkers(),
        api.getTrips(),
        api.getLedger().catch(() => ({ dayRule: 'presence', rules: [], planned: [] }))
    ]);
    state.markers = markers;
    state.trips = trips;
    state.ledger = { settings: ledgerSettings, changes: null, overview: null, alerted: false };
    state.unlocked = null;
    state.ideas = null;
    setView('main');
    let savedTab = 'explore';
    try {
        savedTab = localStorage.getItem('travelmapster.tab') || 'explore';
    } catch {
        // Ignore unavailable storage.
    }
    state.activeTab = TAB_RENDERERS[savedTab] ? savedTab : 'explore';
    refresh({ celebrateNew: false });
    selectTab(state.activeTab);
    announceLedgerAlerts();
}

async function startPublicView(username) {
    try {
        const data = await api.getPublicMap(username);
        state.publicUser = data.username;
        // A replica of an older release sends no list: count every territory, as it did.
        state.publicCountryList = data.countryList || 'all';
        state.publicJourneys = Boolean(data.showJourneys);
        state.markers = data.markers;
        refresh({ celebrateNew: false });
        $('#public-title').textContent = `${data.username}'s travel map`;
        renderPublicStats($('#public-stats'), state.stats);
        setView('public');
        document.title = `${data.username}'s travel map · TravelMapster`;
    } catch (error) {
        toast(error.message, { tone: 'error' });
        history.replaceState(null, '', '/');
        await boot();
    }
}

// ---------------------------------------------------------------- panel & legend

function setupPanel() {
    const handle = $('#panel-handle');
    handle.addEventListener('click', () => {
        const collapsed = $('#panel').classList.toggle('is-collapsed');
        handle.setAttribute('aria-expanded', String(!collapsed));
    });
}

function setupLegend() {
    $('#legend-detail-filter').addEventListener('click', () => setDetailFilter({ tag: 'all', rating: 'all' }));
    for (const button of $all('.legend-item[data-filter]')) {
        button.addEventListener('click', () => {
            const key = button.dataset.filter;
            state.filters[key] = !state.filters[key];
            button.setAttribute('aria-pressed', String(state.filters[key]));
            refresh({ celebrateNew: false });
        });
    }
}

// Shared context passed to the tab modules.
const context = {
    state,
    get map() { return travelMap; },
    api,
    refresh,
    savePlace,
    updatePlace,
    removePlace,
    editPlace,
    setDetailFilter,
    markContinent,
    startSelecting,
    showMarker,
    showIdeas,
    handleError,
    confirmDialog,
    selectTab,
    reloadMarkers,
    flagEmoji,
    currentLedger,
    saveLedger,
    loadVisitChanges,
    showCountry: country => travelMap.flyToCountry(country).then(() => showCountryCard(country))
};

// ---------------------------------------------------------------- boot

async function boot() {
    const username = new URLSearchParams(location.search).get('u');
    if (username) {
        await startPublicView(username);
        return;
    }
    try {
        await startSession();
    } catch {
        showSignedOut();
    }
}

async function init() {
    // Start with this browser's palette; a signed-in traveler's own choice follows.
    applyPalette(storedPalette());
    await loadMapData();
    travelMap = createTravelMap($('#map'), {
        index: state.index,
        cities: state.cities,
        // While picking countries, clicks pick the country instead of opening its card.
        onCountryClick: (country, latlng) => (state.selection ? toggleSelected(country) : showCountryCard(country, latlng)),
        onCityClick: city => (state.selection ? toggleSelected(state.index.byId.get(city.countryId)) : showCityCard(city)),
        // A pin may show a place as the timeline trims it; its card shows the whole place.
        onPinClick: pinned => {
            const marker = state.markers.find(item => item.id === pinned.id) || pinned;
            if (state.selection) toggleSelected(state.stats.markerCountry.get(marker.id));
            else showSavedCityCard(marker);
        },
        // On phones, tuck the bottom sheet away so map cards have room.
        onPopupOpen: () => {
            if (window.innerWidth <= 760) {
                $('#panel').classList.add('is-collapsed');
                $('#panel-handle').setAttribute('aria-expanded', 'false');
            }
        }
    });
    setupSearch();
    setupTabs();
    setupAuth();
    setupAccountMenu();
    setupPanel();
    setupLegend();
    setupSelectBar();
    setupLanding();
    setupTimeline();
    setupPrinting();
    $('#surprise-btn').addEventListener('click', surprise);
    await boot();
}

init().catch(error => {
    console.error(error);
    $('#loading-view').replaceChildren(h('p', { class: 'form-error' }, 'The map could not load. Please refresh the page.'));
});
