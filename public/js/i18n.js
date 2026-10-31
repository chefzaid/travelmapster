// Translations (ADR 0031): the interface in English, French, Spanish, German or Arabic. English
// text is the key: t('Trip saved.') looks it up in public/locales/<locale>.json and falls back to
// the English. Values fill {name} placeholders; tn() picks the plural form the language needs.
// Pure apart from loadLocale() and translateDom(), unit tested in Node.

export const LOCALES = Object.freeze({
    en: { name: 'English', dir: 'ltr' },
    fr: { name: 'Français', dir: 'ltr' },
    es: { name: 'Español', dir: 'ltr' },
    de: { name: 'Deutsch', dir: 'ltr' },
    ar: { name: 'العربية', dir: 'rtl' }
});

const STORAGE_KEY = 'travelmapster.locale';

let current = 'en';
let catalog = {};
let plurals = new Intl.PluralRules('en');

/** The interface's language. */
export const locale = () => current;

/** Whether the interface reads right to left. */
export const isRtl = () => LOCALES[current].dir === 'rtl';

/**
 * The supported language closest to a list such as navigator.languages ('fr-CA' → 'fr').
 * @param {readonly string[]} languages
 */
export function matchLocale(languages = []) {
    for (const language of languages) {
        const code = String(language).toLowerCase().split('-')[0];
        if (Object.hasOwn(LOCALES, code)) return code;
    }
    return 'en';
}

/** The language chosen in this browser, or the browser's own. */
export function preferredLocale() {
    let stored = null;
    try {
        stored = localStorage.getItem(STORAGE_KEY);
    } catch {
        // Storage can be unavailable; the browser's languages decide.
    }
    return Object.hasOwn(LOCALES, stored) ? stored : matchLocale(globalThis.navigator?.languages || []);
}

/** Remembers the chosen language in this browser. */
export function rememberLocale(code) {
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch {
        // The choice lasts for this page only.
    }
}

/** Uses a catalog for a language: { english: translation or plural forms }. */
export function useCatalog(code, entries = {}) {
    current = Object.hasOwn(LOCALES, code) ? code : 'en';
    catalog = current === 'en' ? {} : entries;
    plurals = new Intl.PluralRules(current);
}

function fillParams(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/**
 * Marks English text kept in a constant, such as a label table, for the catalogs; it is
 * translated with t() where it is shown, once the language is known.
 */
export const tk = text => text;

/** The text in the interface's language, with {name} placeholders filled from `params`. */
export function t(text, params) {
    const translated = catalog[text];
    return fillParams(typeof translated === 'string' && translated ? translated : text, params);
}

/**
 * A sentence with elements in it, such as emphasis: tParts('Used {days} so far', { days:
 * h('strong', {}, '12') }) gives ['Used ', <strong>, ' so far'] for h() to hold, so the
 * translation can move the element where its language needs it.
 */
export function tParts(text, params) {
    const translated = catalog[text];
    const template = typeof translated === 'string' && translated ? translated : text;
    return template.split(/(\{\w+\})/).filter(Boolean)
        .map(part => {
            const name = part.match(/^\{(\w+)\}$/)?.[1];
            return name && Object.hasOwn(params, name) ? params[name] : part;
        });
}

/**
 * A text with a count, in the plural form the language needs for it: tn(3, '{count} day',
 * '{count} days'). The catalog keys it by the English plural and holds the language's forms
 * (zero, one, two, few, many, other).
 */
export function tn(count, one, other, params = {}) {
    const forms = catalog[other];
    const values = { ...params, count: formatNumber(count) };
    if (forms && typeof forms === 'object') {
        const form = forms[plurals.select(count)] || forms.other;
        if (form) return fillParams(form, values);
    }
    return fillParams(count === 1 ? one : other, values);
}

/** A number written the language's way. */
export function formatNumber(value, options) {
    return Number(value).toLocaleString(current, options);
}

/** Items joined the language's way: "A, B, and C" in English, "A وB وC" in Arabic. */
export function formatList(items) {
    return new Intl.ListFormat(current, { type: 'conjunction' }).format(items);
}

/** Fetches and uses a language's catalog, and sets the page's language and direction. */
export async function loadLocale(code) {
    let entries = {};
    if (code !== 'en' && Object.hasOwn(LOCALES, code)) {
        const response = await fetch(new URL(`../locales/${code}.json`, import.meta.url));
        if (response.ok) entries = await response.json();
        else code = 'en';
    }
    useCatalog(code, entries);
    const root = globalThis.document?.documentElement;
    if (root) {
        root.lang = current;
        root.dir = LOCALES[current].dir;
    }
}

/** Fills the page's language pickers (`data-language-picker`); a choice reloads the page in it. */
export function setupLanguagePickers(root = globalThis.document) {
    for (const select of /** @type {NodeListOf<HTMLSelectElement>} */ (root.querySelectorAll('select[data-language-picker]'))) {
        select.replaceChildren(...Object.entries(LOCALES).map(([code, { name }]) => {
            const option = root.createElement('option');
            option.value = code;
            option.lang = code;
            option.textContent = name;
            option.selected = code === current;
            return option;
        }));
        select.addEventListener('change', () => {
            rememberLocale(select.value);
            location.reload();
        });
    }
}

// The inline elements of a `data-i18n-parts` sentence, kept to put back into its translation.
const sentenceParts = new WeakMap();

/**
 * The key of a sentence holding elements: its text, with each element child as {1}, {2}…,
 * whitespace collapsed (scripts/i18n.js reads the markup the same way).
 */
function sentenceKey(nodes) {
    let n = 0;
    return nodes.map(node => (node.nodeType === 1 ? `{${++n}}` : node.textContent)).join('').trim().replace(/\s+/g, ' ');
}

/**
 * Translates the page's own markup: the text of elements marked `data-i18n`, the attributes
 * named in `data-i18n-attr` (such as "aria-label placeholder"), and sentences marked
 * `data-i18n-parts`, whose inline elements move where the translation puts them.
 */
export function translateDom(root = globalThis.document) {
    for (const element of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-i18n]'))) {
        element.dataset.i18nText ??= element.textContent.trim().replace(/\s+/g, ' ');
        element.textContent = t(element.dataset.i18nText);
    }
    for (const element of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-i18n-attr]'))) {
        for (const name of element.dataset.i18nAttr.split(/\s+/).filter(Boolean)) {
            const key = `i18n${name.replace(/(^|-)(\w)/g, (match, dash, letter) => letter.toUpperCase())}`;
            element.dataset[key] ??= element.getAttribute(name) || '';
            element.setAttribute(name, t(element.dataset[key]));
        }
    }
    for (const element of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-i18n-parts]'))) {
        if (!sentenceParts.has(element)) sentenceParts.set(element, [...element.childNodes]);
        const nodes = sentenceParts.get(element);
        const elements = nodes.filter(node => node.nodeType === 1);
        const parts = tParts(sentenceKey(nodes), Object.fromEntries(elements.map((node, i) => [String(i + 1), node])));
        element.replaceChildren(...parts.map(part => (typeof part === 'string' ? document.createTextNode(part) : part)));
    }
}
