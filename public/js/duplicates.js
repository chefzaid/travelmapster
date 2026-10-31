// Places saved twice, often after an import: two places of the same kind with the same name, or
// two towns a short walk apart. Each pair keeps the place with more visits (or the older one) and
// merges the other into it, keeping every visit. Pure, unit tested in Node.
import { normalizeName } from './geo.js';
import { distanceKm } from './travel-stats.js';

// Two town pins closer than this are one town, as the import finds towns (towns.js).
const SAME_TOWN_KM = 2;

const sameName = (a, b) => normalizeName(a.name) === normalizeName(b.name);
const near = (a, b) => a.category === 'City' && distanceKm(a, b) < SAME_TOWN_KM;

/**
 * Likely duplicates as `{ keep, other }` pairs, each place in one pair at most: the same kind of
 * place (country or town) with the same name, or two towns closer than 2 km.
 */
export function findDuplicates(markers) {
    const pairs = [];
    const taken = new Set();
    const rank = marker => [-(marker.visits?.length || 0), marker.id];
    const sorted = [...markers].sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
    for (const [i, keep] of sorted.entries()) {
        if (taken.has(keep.id)) continue;
        for (const other of sorted.slice(i + 1)) {
            if (taken.has(other.id) || other.category !== keep.category || !(sameName(keep, other) || near(keep, other))) continue;
            pairs.push({ keep, other });
            taken.add(keep.id).add(other.id);
            break;
        }
    }
    return pairs;
}
