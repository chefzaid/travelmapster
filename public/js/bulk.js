// Marking several countries at once, and undoing it, as one bulk change of places
// (POST /api/markers/bulk). Pure functions, unit tested in Node.

/**
 * The changes that give every chosen country the status `type`. A country already saved
 * with another status changes it; one with that status is left alone. Marking a wishlist
 * never takes away a visit: countries visited, as a country or through a city, are skipped.
 *
 * `countryMarkerOf(country)` finds the saved country place, and `visitedIds` holds the
 * countries the map colors in as visited.
 */
export function planBulkMark({ countries, type, countryMarkerOf, visitedIds = new Set() }) {
    const create = [];
    const update = [];
    let unchanged = 0;
    for (const country of countries) {
        const existing = countryMarkerOf(country);
        const visited = existing ? existing.type === 'visited' : visitedIds.has(country.id);
        if (existing?.type === type || (type === 'wishlist' && visited)) {
            unchanged += 1;
        } else if (existing) {
            update.push({ id: existing.id, type, previous: existing.type });
        } else {
            create.push({ lat: country.label[0], lng: country.label[1], name: country.name, category: 'Country', type });
        }
    }
    return { create, update, unchanged };
}

/** The request body for a plan: status changes carry only the id and the new status. */
export function bulkRequest(plan) {
    return { create: plan.create, update: plan.update.map(({ id, type }) => ({ id, type })) };
}

/** The bulk change that undoes an applied plan: remove what it created and restore statuses. */
export function undoRequest(plan, result) {
    return {
        remove: result.created.map(marker => marker.id),
        update: plan.update.map(({ id, previous }) => ({ id, type: previous }))
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
    const what = count === 1 ? '1 country' : `${count} countries`;
    const status = type === 'visited' ? 'been there' : 'wishlist';
    const already = plan.unchanged ? ` (${plan.unchanged} already ${type === 'visited' ? 'colored in' : 'set or visited'})` : '';
    return `Marked ${what} as ${status}${already}.`;
}
