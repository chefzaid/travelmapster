// Guest mode in the page (ADR 0026): starting and leaving it, the account menu and the note a
// guest sees, and moving a guest map into an account once the guest signs up or logs in.
import { $, $all, toast } from './ui.js';
import { api, useApi } from './api.js';
import { clearGuestMap, createGuestApi, hasGuestMap } from './guest-api.js';
import { savePlaces } from './import-apps.js';

const ACTIVE_KEY = 'travelmapster.guest.active';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function storage() {
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

/** Whether this browser was last used as a guest, so the guest map opens again. */
export function guestActive() {
    try {
        return storage()?.getItem(ACTIVE_KEY) === '1';
    } catch {
        return false;
    }
}

function setGuestActive(active) {
    try {
        if (active) storage()?.setItem(ACTIVE_KEY, '1');
        else storage()?.removeItem(ACTIVE_KEY);
    } catch {
        // Without storage a guest map cannot open again anyway.
    }
}

/** Answers from this browser's guest map from now on; resolves to the guest user. */
export function enterGuestMode() {
    const store = storage();
    if (!store) throw new Error('This browser does not let pages keep data, so a guest map cannot be saved. Sign up instead.');
    useApi(createGuestApi(store));
    setGuestActive(true);
    return api.currentUser();
}

/** Back to the server's API; the guest map stays in this browser. */
export function leaveGuestMode() {
    setGuestActive(false);
    useApi(null);
}

/** Shows the account menu and the panel note for a guest or for an account. */
export function showGuestControls(guest) {
    for (const element of $all('[data-account-only]')) element.hidden = guest;
    for (const element of $all('[data-guest-only]')) element.hidden = !guest;
    $('#logout-btn').textContent = guest ? '👋 Leave guest map' : '👋 Log out';
}

/** Labels the buttons that start guest mode, once a guest map exists in this browser. */
export function labelGuestButtons() {
    const resume = hasGuestMap(storage() ?? { getItem: () => null });
    for (const button of $all('[data-guest-start]')) {
        button.textContent = resume ? 'Continue your guest map' : 'Try it without an account';
    }
}

/**
 * Moves the guest map of this browser into the account just opened: places with their visits,
 * trips, the ledger's rules and plans, and for a new account the settings too. An account that
 * already has a map asks first; declining keeps the guest map in this browser.
 */
export async function moveGuestMap(ctx) {
    const store = storage();
    if (!store || !hasGuestMap(store)) return;
    const guest = createGuestApi(store);
    const [places, trips, ledger, profile] = await Promise.all([guest.getMarkers(), guest.getTrips(), guest.getLedger(), guest.currentUser()]);
    if (!places.length && !trips.length && !ledger.rules.length && !ledger.planned.length) {
        clearGuestMap(store);
        return;
    }
    const { state } = ctx;
    const own = state.markers.length > 0 || state.trips.length > 0;
    if (own && !(await ctx.confirmDialog({
        title: 'Add your guest map to this account?',
        message: `This browser holds a guest map with ${plural(places.length, 'place', 'places')} and ${plural(trips.length, 'trip', 'trips')}. `
            + `Add them to ${state.user.username}'s map? Places you already have only get the visits they lack.`,
        confirmLabel: 'Add them'
    }))) return;
    try {
        await savePlaces(ctx, places);
        for (const trip of [...trips].reverse()) state.trips.unshift(await ctx.api.createTrip(trip));
        const { settings } = state.ledger;
        const known = items => new Set(items.map(item => item.id));
        const rules = ledger.rules.filter(rule => !known(settings.rules).has(rule.id));
        const planned = ledger.planned.filter(stay => !known(settings.planned).has(stay.id));
        if (rules.length || planned.length) {
            await ctx.saveLedger({ ...settings, rules: [...settings.rules, ...rules], planned: [...settings.planned, ...planned] });
        }
        if (!own) {
            const { homeCountry, countryList, mapPalette, goals } = profile;
            await ctx.saveSettings({ homeCountry, countryList, mapPalette, goals }, 'Your guest map is now saved in your account. 🎉');
        } else {
            toast('Your guest map is now part of your account. 🎉', { tone: 'success' });
        }
        clearGuestMap(store);
        ctx.refresh();
    } catch (error) {
        ctx.handleError(error);
        toast('Your guest map stays in this browser: try again from the account menu once you are back online.', { tone: 'error' });
    }
}

/** Clears the guest map of this browser, once the guest confirms. */
export async function clearGuest(ctx) {
    if (!(await ctx.confirmDialog({
        title: 'Clear your guest map?',
        message: 'Its places, visits, trips and plans are only in this browser, and will be gone for good.',
        confirmLabel: 'Clear guest map',
        danger: true
    }))) return;
    clearGuestMap(storage());
    leaveGuestMode();
    ctx.showSignedOut();
    labelGuestButtons();
    toast('Guest map cleared.');
}

export function setupGuest(ctx) {
    labelGuestButtons();
    for (const button of $all('[data-guest-start]')) button.addEventListener('click', () => ctx.startGuest());
    for (const button of $all('[data-guest-save]')) button.addEventListener('click', () => ctx.saveGuestMap());
    $('#guest-clear-btn')?.addEventListener('click', () => clearGuest(ctx));
}
