// How the traveler knows a saved place (ADR 0014): been there on a visit, lived there,
// passed through on a layover only, or wishlist. The API keeps the status as `type`
// (visited or wishlist) and, for places been to, a `stay` (visit, lived or transit), so the
// previous release reads every place been to as a plain visit. Pure, unit tested in Node.

export const STATUSES = [
    { id: 'visited', type: 'visited', stay: 'visit', icon: '✓', label: 'Been there', filter: '✓ Been', saved: 'Stamped', pin: '✓' },
    { id: 'lived', type: 'visited', stay: 'lived', icon: '🔑', label: 'Lived there', filter: '🔑 Lived', saved: 'Lived in', pin: '⌂' },
    { id: 'transit', type: 'visited', stay: 'transit', icon: '🛫', label: 'Transit only', filter: '🛫 Transit', saved: 'Passed through', pin: '»' },
    { id: 'wishlist', type: 'wishlist', stay: 'visit', icon: '♥', label: 'Wishlist', filter: '♥ Wish', saved: 'Wishlisted', pin: '♥' }
];

export const HOME = { icon: '🏠', label: 'Home country' };

const byId = new Map(STATUSES.map(status => [status.id, status]));

/** The status of a saved place; anything unknown reads as a plain visit or a wish. */
export function statusOf(marker) {
    if (marker?.type !== 'visited') return 'wishlist';
    return marker.stay === 'lived' || marker.stay === 'transit' ? marker.stay : 'visited';
}

export function statusInfo(id) {
    return byId.get(id) || byId.get('visited');
}

/** The API fields for a status. */
export function statusFields(id) {
    const { type, stay } = statusInfo(id);
    return { type, stay };
}

export function statusLabel(id) {
    const { icon, label } = statusInfo(id);
    return `${icon} ${label}`;
}

/** Places lived in or visited count as countries been to; a layover and a wish do not. */
export function countsAsBeen(marker) {
    const status = statusOf(marker);
    return status === 'visited' || status === 'lived';
}
