// App shell: state, loading and saving places, the map filters, tabs, the signed-in,
// signed-out and public views, and the context handed to every feature module.
import { api } from './api.js';
import { createCountryIndex, computeStats, countryStatus } from './geo.js';
import { createTravelMap } from './map.js';
import { h, $, $all, toast, confirmDialog } from './ui.js';
import { describeDetailFilter, detailFilterActive, matchesDetails } from './details.js';
import { renderPlaces } from './places.js';
import { renderTrips } from './trips.js';
import { renderPassport, renderPublicStats } from './passport.js';
import { renderLedger } from './ledger.js';
import { localToday } from './days.js';
import { announceLedgerAlerts, currentLedger, emptyLedger, loadVisitChanges, updateLedgerBadge } from './ledger-store.js';
import { DEMO_HOME, demoMarkers } from './demo.js';
import { STATUSES, statusInfo, statusOf } from './status.js';
import { celebrate } from './confetti.js';
import { renderTimeline, setTimelineOpen, setupTimeline, timelineView, collapsePanelOnPhones } from './timeline-bar.js';
import { applyPalette, setupPrinting, storedPalette } from './printing.js';
import { markContinent, setupSelectBar, startSelecting, stopSelecting, toggleSelected } from './selection.js';
import { countryMarker, showCityCard, showCountryCard, showMarker, showSavedCityCard } from './cards.js';
import { editPlace } from './place-form.js';
import { setupSearch } from './search.js';
import { renderExplore, showIdeas } from './explore.js';
import { AUTH_HASHES, closeAccountMenu, openAuth, renderDemoLedger, setupAccountMenu, setupAuth } from './account.js';

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
    ledger: emptyLedger()
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
    const timeline = timelineView(context);
    let markers = timeline ? timeline.markers : state.markers;
    if (filtered) markers = markers.filter(marker => matchesDetails(marker, state.filters));
    const status = filtered || timeline
        ? countryStatus(markers, countryOfMarker, { homeId: state.stats.homeId })
        : state.stats;
    travelMap.setCountryStatus(status, shown);
    const visible = markers.filter(marker => state.filters[statusOf(marker)]);
    travelMap.setPins(visible);
    renderTimeline(context, timeline, visible);
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
    updateLedgerBadge(context);
    renderActiveTab();
    if (state.demo) renderDemoLedger(context);
}

// ---------------------------------------------------------------- day ledger

async function saveLedger(settings) {
    state.ledger.settings = await api.saveLedger(settings);
    refresh({ celebrateNew: false });
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

function handleError(error) {
    if (error.status === 401) {
        toast('Your session expired. Please log in again.', { tone: 'error' });
        showSignedOut();
        return;
    }
    toast(error.message || 'Something went wrong.', { tone: 'error' });
}

// Saves account settings and recounts the map and passport with them.
async function saveSettings(changes, message) {
    try {
        const profile = await api.saveProfile(changes);
        Object.assign(state.user, profile);
        if (profile.mapPalette) applyPalette(context, profile.mapPalette);
        refresh();
        toast(message, { tone: 'success' });
    } catch (error) {
        handleError(error);
    }
}

// ---------------------------------------------------------------- tabs

const TAB_RENDERERS = {
    explore: container => renderExplore(container, context),
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

// ---------------------------------------------------------------- views

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
    state.ledger = emptyLedger();
    $('#account').hidden = true;
    stopSelecting(context);
    setTimelineOpen(context, false);
    travelMap.closePopup();
    refresh({ celebrateNew: false });
    setView('welcome');
    if (AUTH_HASHES[location.hash]) openAuth(AUTH_HASHES[location.hash]);
}

async function startSession() {
    const user = await api.currentUser();
    state.user = user;
    state.demo = false;
    setTimelineOpen(context, false);
    // A replica of the previous release sends no palette: keep this browser's.
    if (user.mapPalette) applyPalette(context, user.mapPalette);
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
        api.getLedger().catch(() => emptyLedger().settings)
    ]);
    state.markers = markers;
    state.trips = trips;
    state.ledger = { ...emptyLedger(), settings: ledgerSettings };
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
    announceLedgerAlerts(context);
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

// Shared context passed to the feature modules.
const context = {
    state,
    get map() { return travelMap; },
    api,
    refresh,
    applyFilters,
    renderActiveTab,
    savePlace,
    updatePlace,
    removePlace,
    editPlace: marker => editPlace(context, marker),
    setDetailFilter,
    markContinent: (continent, type) => markContinent(context, continent, type),
    startSelecting: () => startSelecting(context),
    stopSelecting: () => stopSelecting(context),
    toggleSelected: country => toggleSelected(context, country),
    setTimelineOpen: open => setTimelineOpen(context, open),
    countryMarker: country => countryMarker(context, country),
    showMarker: marker => showMarker(context, marker),
    showIdeas: destination => showIdeas(context, destination),
    handleError,
    confirmDialog,
    selectTab,
    reloadMarkers,
    currentLedger: () => currentLedger(context),
    saveLedger,
    saveSettings,
    loadVisitChanges: () => loadVisitChanges(context),
    closeAccountMenu,
    startSession,
    showSignedOut
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
    applyPalette(context, storedPalette());
    await loadMapData();
    travelMap = createTravelMap($('#map'), {
        index: state.index,
        cities: state.cities,
        // While picking countries, clicks pick the country instead of opening its card.
        onCountryClick: (country, latlng) => (state.selection ? toggleSelected(context, country) : showCountryCard(context, country, latlng)),
        onCityClick: city => (state.selection ? toggleSelected(context, state.index.byId.get(city.countryId)) : showCityCard(context, city)),
        // A pin may show a place as the timeline trims it; its card shows the whole place.
        onPinClick: pinned => {
            const marker = state.markers.find(item => item.id === pinned.id) || pinned;
            if (state.selection) toggleSelected(context, countryOfMarker(marker));
            else showSavedCityCard(context, marker);
        },
        // Map cards need the room the bottom sheet takes on phones.
        onPopupOpen: collapsePanelOnPhones
    });
    setupSearch(context);
    setupTabs();
    setupAuth(context);
    setupAccountMenu(context);
    setupPanel();
    setupLegend();
    setupSelectBar(context);
    setupTimeline(context);
    setupPrinting(context);
    await boot();
}

init().catch(error => {
    console.error(error);
    $('#loading-view').replaceChildren(h('p', { class: 'form-error' }, 'The map could not load. Please refresh the page.'));
});
