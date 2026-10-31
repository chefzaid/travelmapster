// Merging two saved places that are the same place (two pins for one town, often after an
// import): the place kept takes the other's visits and the details it lacks; the other goes.
// Shared by the API (src/repositories.js, through src/browser-modules.js) and guest maps, so
// both merge alike. Pure, unit tested in Node.
const NOTES_MAX_LENGTH = 2000;
const TAGS_MAX_PER_PLACE = 8;

const joinNotes = (a, b) => [...new Set([a, b].map(text => (text || '').trim()).filter(Boolean))].join('\n\n').slice(0, NOTES_MAX_LENGTH);

/**
 * The kept place's fields after the merge: a place been to wins over a wish, notes and tags are
 * combined (within their limits), a missing photo link, rating, emoji or wishlist plan is taken
 * from the other, and the place stays hidden from the public map if either was.
 */
export function mergedDetails(keep, other) {
    const status = keep.type === 'wishlist' && other.type === 'visited' ? other : keep;
    return {
        lat: keep.lat, lng: keep.lng, name: keep.name, category: keep.category,
        type: status.type, stay: status.type === 'visited' ? status.stay : 'visit',
        notes: joinNotes(keep.notes, other.notes),
        photoUrl: keep.photoUrl || other.photoUrl || null,
        rating: keep.rating ?? other.rating ?? null,
        tags: [...new Set([...(keep.tags || []), ...(other.tags || [])])].slice(0, TAGS_MAX_PER_PLACE),
        emoji: keep.emoji || other.emoji || null,
        hideFromPublic: Boolean(keep.hideFromPublic || other.hideFromPublic),
        priority: keep.priority ?? other.priority ?? null,
        bestMonths: keep.bestMonths?.length ? keep.bestMonths : other.bestMonths || []
    };
}
