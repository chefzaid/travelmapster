// Light or dark: following the system, or the traveler's choice kept in this browser. The
// stylesheets keep their dark rules in `@media (prefers-color-scheme: dark)` blocks; a choice
// turns those blocks on or off, so no rule is written twice. Unit tested in Node.
import { t } from './i18n.js';

export const THEMES = {
    system: { media: '(prefers-color-scheme: dark)', get label() { return t('Like the system'); } },
    light: { media: 'not all', get label() { return t('Light'); } },
    dark: { media: 'all', get label() { return t('Dark'); } }
};

const STORAGE_KEY = 'travelmapster.theme';

/** The theme chosen in this browser, or "system". */
export function storedTheme() {
    let stored = null;
    try {
        stored = localStorage.getItem(STORAGE_KEY);
    } catch {
        // Storage can be unavailable; the system decides.
    }
    return Object.hasOwn(THEMES, stored) ? stored : 'system';
}

export function rememberTheme(theme) {
    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch {
        // The choice lasts for this page only.
    }
}

// The stylesheets' dark blocks, found once: their media text changes with the choice.
let darkRules = null;
function findDarkRules(root) {
    const rules = [];
    for (const sheet of root.styleSheets) {
        let list;
        try {
            list = sheet.cssRules;
        } catch {
            continue; // Another origin's stylesheet cannot be read.
        }
        for (const rule of list) {
            if (rule.media?.mediaText.includes('prefers-color-scheme: dark')) rules.push(rule);
        }
    }
    return rules;
}

/** Shows the page in a theme: the system's, light or dark. */
export function applyTheme(theme, root = globalThis.document) {
    const { media } = THEMES[theme] || THEMES.system;
    darkRules ??= findDarkRules(root);
    for (const rule of darkRules) rule.media.mediaText = media;
    root.documentElement.dataset.theme = Object.hasOwn(THEMES, theme) ? theme : 'system';
}
