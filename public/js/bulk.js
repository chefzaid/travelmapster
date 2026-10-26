// Marking several countries at once, and undoing it, as one bulk change of places
// (POST /api/markers/bulk). Pure functions, unit tested in Node.
import { statusOf } from './status.js';
import { tn } from './i18n.js';

/**
 * The changes that give every chosen country the status `type`. A country already saved
 * with another status changes it; one with that status is left alone. Marking countries
 * "been there" turns a layover into a visit but leaves places lived in and the home country
 * alone (ADR 0014). Marking a wishlist never takes away a visit or a layover: countries been
 * to, as a country or through a city, are skipped.
 *
 * `countryMarkerOf(country)` finds the saved country place; `visitedIds` and `transitIds`
 * hold the countries the map colors in as been to (home included) and as layovers only.
 */
export function planBulkMark({ countries, type, countryMarkerOf, visitedIds = new Set(), transitIds = new Set(), homeId = null }) {
    const create = [];
    const update = [];
    let unchanged = 0;
    for (const country of countries) {
        const existing = countryMarkerOf(country);
        const status = existing ? statusOf(existing) : null;
        // A saved country is already a wish or been to, which a wish never replaces.
        const keep = type === 'visited'
            ? status === 'visited' || status === 'lived' || (!existing && country.id === homeId)
            : Boolean(existing) || visitedIds.has(country.id) || transitIds.has(country.id);
        if (keep) {
            unchanged += 1;
        } else if (existing) {
            update.push({ id: existing.id, type, stay: 'visit', previous: { type: existing.type, stay: existing.stay || 'visit' } });
        } else {
            create.push({ lat: country.label[0], lng: country.label[1], name: country.name, category: 'Country', type });
        }
    }
    return { create, update, unchanged };
}

/** The request body for a plan: status changes carry only the id, the status and the stay. */
export function bulkRequest(plan) {
    return { create: plan.create, update: plan.update.map(({ id, type, stay }) => ({ id, type, stay })) };
}

/** The bulk change that undoes an applied plan: remove what it created and restore statuses. */
export function undoRequest(plan, result) {
    return {
        remove: result.created.map(marker => marker.id),
        update: plan.update.map(({ id, previous }) => ({ id, ...previous }))
    };
}

/** Saved places after a bulk change answered by the API. */
export function applyBulkResult(markers, { created = [], updated = [], removed = [] }) {
    const gone = new Set(removed);
    const changed = new Map(updated.map(marker => [marker.id, marker]));
    return [...markers.filter(marker => !gone.has(marker.id)).map(marker => changed.get(marker.id) || marker), ...created];
}

export function bulkSummary(plan, type) {
    const count = plan.create.length + plan.update.length;
    const marked = type === 'visited'
        ? tn(count, 'Marked {count} country as been there', 'Marked {count} countries as been there')
        : tn(count, 'Marked {count} country as wishlist', 'Marked {count} countries as wishlist');
    if (!plan.unchanged) return `${marked}.`;
    const already = type === 'visited'
        ? tn(plan.unchanged, '{count} already colored in', '{count} already colored in')
        : tn(plan.unchanged, '{count} already set or visited', '{count} already set or visited');
    return `${marked} (${already}).`;
}
