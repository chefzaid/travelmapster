// The panel's tabs: which one shows, remembered in this browser, and drawing the open one.
import { $, $all } from './ui.js';
import { showPanel } from './panel.js';
import { renderExplore } from './explore.js';
import { renderPlaces } from './places.js';
import { renderTrips } from './trips.js';
import { renderLedger } from './ledger.js';
import { renderPassport } from './passport.js';

const TAB_RENDERERS = { explore: renderExplore, places: renderPlaces, trips: renderTrips, ledger: renderLedger, passport: renderPassport };
const STORAGE_KEY = 'travelmapster.tab';

/** The tab this browser showed last, or Explore. */
export function storedTab() {
    let saved = 'explore';
    try {
        saved = localStorage.getItem(STORAGE_KEY) || 'explore';
    } catch {
        // Ignore unavailable storage.
    }
    return Object.hasOwn(TAB_RENDERERS, saved) ? saved : 'explore';
}

export function selectTab(ctx, name) {
    ctx.state.activeTab = name;
    showPanel();
    // The open trip's route shows only on the Trips tab.
    if (name !== 'trips') ctx.map?.setItinerary([]);
    for (const tab of $all('.tabs [role="tab"]')) {
        const selected = tab.id === `tab-${name}`;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
    }
    try {
        localStorage.setItem(STORAGE_KEY, name);
    } catch {
        // Storage can be unavailable (private mode); the tab just won't be remembered.
    }
    renderActiveTab(ctx);
}

export function renderActiveTab(ctx) {
    const { state } = ctx;
    if (!state.user || !state.stats) return;
    const container = $(`#${state.activeTab}-tab`);
    const scroll = $('#panel').scrollTop;
    // A filter that re-renders its own tab keeps the keyboard focus on it.
    const focusedId = container.contains(document.activeElement) ? document.activeElement.id : '';
    TAB_RENDERERS[state.activeTab](container, ctx);
    if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    $('#panel').scrollTop = scroll;
}

export function setupTabs(ctx) {
    const tabs = $all('.tabs [role="tab"]');
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(ctx, tab.id.replace('tab-', '')));
        tab.addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            next.focus();
            selectTab(ctx, next.id.replace('tab-', ''));
        });
    });
}
