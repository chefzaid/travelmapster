// How the traveler knows a saved place (ADR 0014): been there on a visit, lived there,
// passed through on a layover only, or wishlist. The API keeps the status as `type`
// (visited or wishlist) and, for places been to, a `stay` (visit, lived or transit), so the
// previous release reads every place been to as a plain visit. Pure, unit tested in Node.
import { t } from './i18n.js';

export const STATUSES = [
    { id: 'visited', type: 'visited', stay: 'visit', icon: '✓', get label() { return t('Been there'); }, get filter() { return t('✓ Been'); }, get saved() { return t('Stamped'); }, pin: '✓' },
    { id: 'lived', type: 'visited', stay: 'lived', icon: '🔑', get label() { return t('Lived there'); }, get filter() { return t('🔑 Lived'); }, get saved() { return t('Lived in'); }, pin: '⌂' },
    { id: 'transit', type: 'visited', stay: 'transit', icon: '🛫', get label() { return t('Transit only'); }, get filter() { return t('🛫 Transit'); }, get saved() { return t('Passed through'); }, pin: '»' },
    { id: 'wishlist', type: 'wishlist', stay: 'visit', icon: '♥', get label() { return t('Wishlist'); }, get filter() { return t('♥ Wish'); }, get saved() { return t('Wishlisted'); }, pin: '♥' }
];

export const HOME = { icon: '🏠', get label() { return t('Home country'); } };

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
