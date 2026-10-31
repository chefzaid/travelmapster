// Kilometers or miles for distances, chosen in Settings and kept in this browser like the
// language; at first, miles where roads are signed in them (the United States, the United
// Kingdom, Liberia and Myanmar). Pure apart from storage, unit tested in Node.
import { formatNumber, t } from './i18n.js';

export const DISTANCE_UNITS = {
    km: { unit: 'kilometer', perKm: 1, get label() { return t('Kilometers'); } },
    mi: { unit: 'mile', perKm: 1 / 1.609344, get label() { return t('Miles'); } }
};

const STORAGE_KEY = 'travelmapster.distanceUnit';
const MILE_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

/**
 * The unit a list such as navigator.languages suggests ('en-US' → 'mi').
 * @param {readonly string[]} languages
 */
export function regionalUnit(languages = []) {
    const region = String(languages[0] || '').split('-')[1]?.toUpperCase();
    return MILE_REGIONS.has(region) ? 'mi' : 'km';
}

/** The unit chosen in this browser, or the one its language suggests. */
export function distanceUnit() {
    let stored = null;
    try {
        stored = localStorage.getItem(STORAGE_KEY);
    } catch {
        // Storage can be unavailable; the browser's language decides.
    }
    return Object.hasOwn(DISTANCE_UNITS, stored) ? stored : regionalUnit(globalThis.navigator?.languages || []);
}

export function rememberDistanceUnit(unit) {
    try {
        localStorage.setItem(STORAGE_KEY, unit);
    } catch {
        // The choice lasts for this page only.
    }
}

/** A distance in kilometers, written in the unit and the language's way: "1,234 km", "767 mi". */
export function formatDistance(km, unit = distanceUnit()) {
    const { unit: name, perKm } = DISTANCE_UNITS[unit] || DISTANCE_UNITS.km;
    return formatNumber(Math.round(km * perKm), { style: 'unit', unit: name, unitDisplay: 'short' });
}
