// The presentation page (ADR 0011): shown to signed-out visitors at "/" before the app, which
// stays behind it, inert. Signing up, logging in or exploring the demo map opens the app. A
// browser that was signed in recently waits for the session check, so a returning traveler
// never sees it flash.
import { $, $all } from './ui.js';

const SIGNED_IN_KEY = 'travelmapster.signedIn';

/** Sign-up and log-in links, which open the form at once, without the presentation. */
export const AUTH_HASHES = { '#sign-up': 'register', '#log-in': 'login' };
/** An invitation to an organization waiting for a sign-in (orgs.js). */
export const INVITATION_KEY = 'travelmapster.join';

/**
 * Whether this visit starts with the presentation: not a public map, a sign-up or log-in link,
 * or an invitation. Known before the rest of the app loads (start.js).
 */
export function presentsFirst() {
    if (new URLSearchParams(location.search).has('u') || AUTH_HASHES[location.hash] || location.hash.startsWith('#join=')) return false;
    try {
        return !sessionStorage.getItem(INVITATION_KEY);
    } catch {
        return true;
    }
}

/** Remembers in this browser whether a traveler is signed in. */
export function rememberSignedIn(signedIn) {
    try {
        if (signedIn) localStorage.setItem(SIGNED_IN_KEY, '1');
        else localStorage.removeItem(SIGNED_IN_KEY);
    } catch {
        // Storage can be unavailable; the presentation then waits for the session check.
    }
}

export function wasSignedIn() {
    try {
        return localStorage.getItem(SIGNED_IN_KEY) === '1';
    } catch {
        return true;
    }
}

// Once the visitor left the presentation, a late session check does not bring it back.
let dismissed = false;

export function showHome() {
    dismissed = false;
    $('#home').hidden = false;
    $('#app').inert = true;
}

/** Shows the presentation unless the visitor already left it. */
export function offerHome() {
    if (!dismissed) showHome();
}

export function hideHome() {
    dismissed = true;
    if ($('#home').hidden) return;
    $('#home').hidden = true;
    $('#app').inert = false;
}

/** Buttons that leave the presentation for the app, and the one that brings it back. */
export function setupHome() {
    // Signing up or logging in opens the form in the panel (account.js handles the mode).
    for (const button of $all('#home [data-auth-mode], #home [data-home-demo]')) button.addEventListener('click', hideHome);
    for (const button of $all('[data-home-show]')) {
        button.addEventListener('click', () => {
            showHome();
            $('#home').scrollTop = 0;
            $('#home-title').focus?.();
        });
    }
}
