// Who came along on a visit: names only, never accounts, so "everywhere I've been with Sam"
// filters the map. The rules match src/validation-text.js. Pure, unit tested in Node.
import { t } from './i18n.js';

export const COMPANIONS_MAX = 10;
export const COMPANION_MAX_LENGTH = 40;
const SEPARATORS = /[,;،]/;

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Names from a list, or typed in one field between commas or semicolons, each once regardless of case. */
export function readCompanions(value) {
    const list = Array.isArray(value) ? value : String(value ?? '').split(SEPARATORS);
    const names = [];
    for (const item of list) {
        const name = String(item ?? '').trim().replace(/\s+/g, ' ');
        if (name && !names.some(known => same(known, name))) names.push(name);
    }
    return names;
}

/** What is wrong with a visit's companions, or null. */
export function companionsError(names) {
    if (names.length > COMPANIONS_MAX) return t('List at most {COMPANIONS_MAX} people on a visit.', { COMPANIONS_MAX });
    if (names.some(name => name.length > COMPANION_MAX_LENGTH)) return t('Keep each name to {COMPANION_MAX_LENGTH} characters or fewer.', { COMPANION_MAX_LENGTH });
    return null;
}

/** Whether a place has a visit with this companion. */
export const visitedWith = (marker, name) =>
    (marker.visits || []).some(visit => (visit.companions || []).some(known => same(known, name)));

/** Everyone who came along on any visit, with the places shared, the most places first. */
export function companionsOf(markers) {
    const people = [];
    for (const marker of markers) {
        const names = readCompanions((marker.visits || []).flatMap(visit => visit.companions || []));
        for (const name of names) {
            const known = people.find(person => same(person.name, name));
            if (known) known.places += 1;
            else people.push({ name, places: 1 });
        }
    }
    return people.sort((a, b) => b.places - a.places || a.name.localeCompare(b.name));
}
