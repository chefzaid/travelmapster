// App shell: state, loading and saving places, the map filters, tabs, the signed-in,
// signed-out and public views, and the context handed to every feature module.
import { api } from './api.js';
import { computeStats, countryStatus } from './geo.js';
import { loadMapData as loadData } from './map-data.js';
import { h, $, toast, confirmDialog } from './ui.js';
import { describeDetailFilter, detailFilterActive, matchesDetails } from './details.js';
import { renderPublicStats } from './passport.js';
import { renderActiveTab, selectTab, setupTabs, storedTab } from './tabs.js';
import { removePlace, savePlace, updatePlace } from './place-store.js';
import { localToday } from './days.js';
import { announceLedgerAlerts, currentLedger, emptyLedger, loadVisitChanges, updateLedgerBadge } from './ledger-store.js';
import { DEMO_HOME, demoMarkers } from './demo.js';
import { STATUSES, statusOf } from './status.js';
import { celebrate } from './confetti.js';
import { celebrateGoals } from './passport-goals.js';
import { setupOffline } from './offline.js';
import { setupLegend, setupPanel } from './panel.js';
import { mapDays, setupDaysLegend } from './map-days.js';
import { renderTimeline, setTimelineOpen, setupTimeline, timelineView, collapsePanelOnPhones } from './timeline-bar.js';
import { applyPalette, setupPrinting, storedPalette } from './printing.js';
import { markContinent, setupSelectBar, startSelecting, stopSelecting, toggleSelected } from './selection.js';
import { countryMarker, showCityCard, showCountryCard, showMarker, showSavedCityCard } from './cards.js';
import { editPlace } from './place-form.js';
import { setupSearch } from './search.js';
import { showIdeas } from './explore.js';
import { closeAccountMenu, openAuth, renderDemoLedger, setupAccountMenu, setupAuth } from './account.js';
import { AUTH_HASHES, hideHome, offerHome, rememberSignedIn, setupHome, wasSignedIn } from './home.js';
import { followButton } from './friends.js';
import { explainInvitation, joinPendingInvitation, setupInvitations, takeInvitation } from './orgs.js';
import { enterGuestMode, guestActive, labelGuestButtons, leaveGuestMode, moveGuestMap, setupGuest, showGuestControls } from './guest.js';
import { t } from './i18n.js';

const state = {
    user: null,
    markers: [],
    trips: [],
    stats: null,
    index: null,
    cities: [],
    // The capital cities of the map data, for the capitals collection.
    capitals: [],
    publicUser: null,
    // The shared map owner's country list, so visitors see the same counts, and whether they
    // let visitors see journey lines (ADR 0016).
    publicCountryList: 'all',
    publicJourneys: false,
    // Signed out, the map shows a sample traveler that visitors can try; nothing is saved.
    demo: false,
    // The legend's status toggles, and the tag and rating filter shared by the map and the Places tab.
    filters: { visited: true, lived: true, transit: true, wishlist: true, tag: 'all', rating: 'all' },
    // The legend's "Days" switch: countries colored by days spent instead of by status.
    colorByDays: false,
    // The days per country the map shows then, for the country card.
    mapDays: null,
    activeTab: 'explore',
    // Countries picked on the map to mark at once, or null when not picking.
    selection: null,
    // The timeline (ADR 0016): the map by the end of a year or during it, journey lines, the
    // replay choices for the year and a function that stops a running replay.
    timeline: { open: false, year: null, mode: 'by', journeys: false, choices: new Map(), replaying: false, stopReplay: null },
    ideas: null,
    unlocked: null,
    // Goals reached so far, so reaching one is celebrated once.
    reachedGoals: null,
    // The traveler's organizations with their roles and rules (ADR 0029).
    orgs: [],
    // Day ledger: settings from the API, the history of visit dates (loaded when needed)
    // and the overview computed from both, cleared whenever places or visits change.
    ledger: emptyLedger()
};

let travelMap;

// ---------------------------------------------------------------- data

async function loadMapData() {
    const { index, cities } = await loadData();
    state.index = index;
    state.cities = cities;
    state.capitals = cities.filter(city => city.capital);
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
    travelMap.setCountryStatus(status, shown, mapDays(context, timeline));
    const visible = markers.filter(marker => state.filters[statusOf(marker)]);
    travelMap.setPins(visible);
    renderTimeline(context, timeline, visible);
    const clear = $('#legend-detail-filter');
    clear.hidden = !filtered;
    if (filtered) {
        const description = describeDetailFilter(state.filters);
        clear.querySelector('.legend-filter-text').textContent = description;
        clear.setAttribute('aria-label', t('Map filtered to {description}. Clear the filter', { description }));
    }
}

function setDetailFilter(changes) {
    Object.assign(state.filters, changes);
    applyFilters();
    renderActiveTab(context);
}

function refresh({ celebrateNew = true } = {}) {
    state.stats = computeStats(state.markers, state.index, {
        trips: state.trips.length, homeId: homeCountryId(), countryList: countryListId(), capitals: state.capitals
    });
    // Places or settings changed: the ledger counts again, before the map shows its days.
    state.ledger.overview = null;
    state.ledger.changes = null;
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
            toast(t('Badge unlocked: {icon} {title}!', { icon: achievement.icon, title: achievement.title }), { tone: 'success', duration: 5000 });
        }
    }
    state.unlocked = unlocked;
    if (state.user) state.reachedGoals = celebrateGoals(context, celebrateNew ? state.reachedGoals : null);
    updateLedgerBadge(context);
    renderActiveTab(context);
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

function handleError(error) {
    if (error.status === 401) {
        toast(t('Your session expired. Please log in again.'), { tone: 'error' });
        showSignedOut();
        return;
    }
    toast(error.message || t('Something went wrong.'), { tone: 'error' });
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

// ---------------------------------------------------------------- views

function setView(name) {
    for (const view of ['welcome', 'main', 'public', 'loading']) {
        $(`#${view}-view`).hidden = view !== name;
    }
    $('#app').dataset.state = name;
}

function showSignedOut() {
    rememberSignedIn(false);
    // Leaving a guest map keeps it in this browser for next time.
    if (state.user?.guest) leaveGuestMode();
    labelGuestButtons();
    state.user = null;
    state.demo = true;
    state.markers = demoMarkers(localToday());
    state.trips = [];
    state.unlocked = null;
    state.reachedGoals = null;
    state.ideas = null;
    state.ledger = emptyLedger();
    state.orgs = [];
    $('#account').hidden = true;
    stopSelecting(context);
    setTimelineOpen(context, false);
    travelMap.closePopup();
    travelMap.setItinerary([]);
    refresh({ celebrateNew: false });
    setView('welcome');
    if (AUTH_HASHES[location.hash]) openAuth(AUTH_HASHES[location.hash]);
    else if (explainInvitation()) openAuth('login');
}

// Set once a session starts: the landing page shows before the map loads, so a traveler may
// sign in before the first look at the session (at page load) is acted on.
let sessionStarted = false;

// Starts the signed-in view, for `known` user or the session's; it waits for the map.
async function startSession(known) {
    sessionStarted = true;
    hideHome();
    const user = known || await api.currentUser();
    await mapReady;
    state.user = user;
    state.demo = false;
    rememberSignedIn(true);
    showGuestControls(Boolean(user.guest));
    setTimelineOpen(context, false);
    // A replica of the previous release sends no palette: keep this browser's.
    if (user.mapPalette) applyPalette(context, user.mapPalette);
    travelMap.closePopup();
    $('#account').hidden = false;
    $('#account-name').textContent = user.username;
    $('#avatar-initial').textContent = user.username.slice(0, 1).toUpperCase();
    $('#public-toggle').checked = user.profileVisibility === 'public';
    for (const id of ['#copy-share-btn', '#embed-btn']) $(id).disabled = user.profileVisibility !== 'public';

    // A replica of the previous release has no ledger yet during a rollout: start with the defaults.
    const [markers, trips, ledgerSettings, orgs] = await Promise.all([
        api.getMarkers(),
        api.getTrips(),
        api.getLedger().catch(() => emptyLedger().settings),
        api.getOrgs().catch(() => [])
    ]);
    state.markers = markers;
    state.trips = trips;
    state.orgs = orgs;
    state.ledger = { ...emptyLedger(), settings: ledgerSettings };
    state.unlocked = null;
    state.reachedGoals = null;
    state.ideas = null;
    setView('main');
    state.activeTab = storedTab();
    refresh({ celebrateNew: false });
    selectTab(context, state.activeTab);
    announceLedgerAlerts(context);
    // An account opened in a browser used as a guest takes the guest map along.
    if (user.guest) return;
    await moveGuestMap(context);
    // An invitation link opened before signing in asks to join now.
    joinPendingInvitation(context);
}

/** Opens this browser's guest map, kept in its storage (ADR 0026). */
async function startGuest() {
    try {
        hideHome();
        await startSession(await enterGuestMode());
    } catch (error) {
        toast(error.message, { tone: 'error' });
    }
}

// A guest who wants an account signs up; the guest map moves into it.
function saveGuestMap() {
    closeAccountMenu();
    showSignedOut();
    openAuth('register');
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
        $('#public-title').textContent = t('{username}\'s travel map', { username: data.username });
        renderPublicStats($('#public-stats'), state.stats);
        setView('public');
        document.title = t('{username}\'s travel map · TravelMapster', { username: data.username });
        followButton(context, data.username);
    } catch (error) {
        toast(error.message, { tone: 'error' });
        history.replaceState(null, '', '/');
        await boot();
    }
}

// Shared context passed to the feature modules.
const context = {
    state,
    get map() { return travelMap; },
    api,
    refresh,
    applyFilters,
    renderActiveTab: () => renderActiveTab(context),
    savePlace: (place, options) => savePlace(context, place, options),
    updatePlace: (marker, changes) => updatePlace(context, marker, changes),
    removePlace: marker => removePlace(context, marker),
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
    selectTab: name => selectTab(context, name),
    reloadMarkers,
    currentLedger: () => currentLedger(context),
    saveLedger,
    saveSettings,
    loadVisitChanges: () => loadVisitChanges(context),
    closeAccountMenu,
    startSession,
    showSignedOut,
    startGuest,
    saveGuestMap
};

// ---------------------------------------------------------------- boot

// `signedIn` resolves with the session's user, or null when signed out.
async function boot(signedIn = api.currentUser().catch(() => null)) {
    const username = new URLSearchParams(location.search).get('u');
    if (username) {
        await startPublicView(username);
        return;
    }
    const user = await signedIn;
    // Signed in from the landing page meanwhile: that session wins over the stale answer.
    if (sessionStarted) return;
    if (user) {
        try {
            await startSession(user);
            return;
        } catch {
            // Signed out in the meantime: the landing page follows.
        }
    }
    // A browser last used as a guest opens its guest map again.
    if (guestActive()) {
        await startGuest();
        return;
    }
    showSignedOut();
}

// Resolves once the map and its data are ready; whatever draws places waits for it.
let mapReady;

async function createMap() {
    // MapLibre is the largest download: it loads beside the map data, not before the app runs.
    const [{ createTravelMap }] = await Promise.all([import('./map.js'), loadMapData()]);
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
}

// start.js has already set the interface's language (the map data names countries in it, ADR
// 0031) and shown the presentation to a visitor.
async function init() {
    // Start with this browser's palette; a signed-in traveler's own choice follows.
    applyPalette(context, storedPalette());
    setupOffline();
    // The landing page's forms work before the map has loaded. The presentation's buttons open
    // the app before the form takes the focus.
    setupHome();
    setupAuth(context);
    setupGuest(context);
    const publicMap = new URLSearchParams(location.search).has('u');
    const signedIn = publicMap ? Promise.resolve(null) : api.currentUser().catch(() => null);
    // Visitors see the presentation first; a browser signed in recently waits for the session.
    const invited = !publicMap && takeInvitation();
    const presenting = !publicMap && !AUTH_HASHES[location.hash] && !invited;
    if (presenting && !wasSignedIn()) offerHome();
    // Tests and scripts can tell when the map is drawn: the landing page shows before it.
    mapReady = createMap().then(() => { $('#app').dataset.map = 'ready'; });
    // A signed-out visitor reads the landing page while the map is still loading.
    if (!publicMap) {
        signedIn.then(user => {
            if (!user && $('#app').dataset.state === 'loading') setView('welcome');
            if (!user && presenting) offerHome();
        });
    }
    await mapReady;
    setupSearch(context);
    setupTabs(context);
    setupAccountMenu(context);
    setupPanel();
    setupLegend(context);
    setupDaysLegend(context);
    setupSelectBar(context);
    setupTimeline(context);
    setupPrinting(context);
    setupInvitations(context);
    await boot(signedIn);
}

init().catch(error => {
    console.error(error);
    setView('loading');
    $('#loading-view').replaceChildren(h('p', { class: 'form-error' }, t('The map could not load. Please refresh the page.')));
});
