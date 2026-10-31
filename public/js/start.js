// The page's first module: the interface's language and, for a visitor, the presentation,
// shown before the rest of the app loads, which takes seconds on a slow phone. A press on one
// of the presentation's buttons meanwhile waits for the app and then takes effect.
import { $ } from './ui.js';
import { loadLocale, preferredLocale, setupLanguagePickers, translateDom } from './i18n.js';
import { offerHome, presentsFirst, wasSignedIn } from './home.js';
import { applyTheme, storedTheme } from './theme.js';

async function start() {
    // Light or dark as chosen in this browser, before anything else shows.
    applyTheme(storedTheme());
    // The map data names countries in the interface's language (ADR 0031).
    await loadLocale(preferredLocale()).catch(() => {});
    translateDom();
    setupLanguagePickers();
    let pressed = null;
    const hold = event => {
        const button = event.target.closest('button');
        if (!button) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        pressed = button;
    };
    $('#home').addEventListener('click', hold, true);
    // A browser signed in recently waits for the session check in the app instead.
    if (presentsFirst() && !wasSignedIn()) offerHome();
    try {
        await import('./app.js');
    } finally {
        $('#home').removeEventListener('click', hold, true);
    }
    pressed?.click();
}

start().catch(error => console.error(error));
