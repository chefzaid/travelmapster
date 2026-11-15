// "Towns next door" on the card of a town been to: the largest bundled towns within 50 km not
// saved yet, as easy day trips to add to the wishlist. The towns of the region tiles load only
// when the section is opened (towns.js through import-apps.js).
import { h, fill } from './ui.js';
import { normalizeName, shortPlaceName } from './geo.js';
import { statusFields, statusOf } from './status.js';
import { distanceKm } from './travel-stats.js';
import { formatDistance } from './units.js';
import { t } from './i18n.js';

// A saved town is the same town when it has the name nearby, or sits right there.
const SAME_NAME_KM = 10;
const SAME_PLACE_KM = 2;

function saved(ctx, town) {
    return ctx.state.markers.some(marker => {
        if (marker.category !== 'City') return false;
        const distance = distanceKm(marker, town);
        return distance < SAME_PLACE_KM || (distance < SAME_NAME_KM && normalizeName(shortPlaceName(marker.name)) === normalizeName(town.name));
    });
}

function draw(ctx, body, towns) {
    if (!towns.length) {
        fill(body, h('p', { class: 'muted small' }, t('No other town within 50 km that you have not saved yet.')));
        return;
    }
    const countryName = id => ctx.state.index.byId.get(id)?.name || '';
    fill(body,
        h('ul', { class: 'nearby-towns' }, towns.map(town => h('li', {},
            h('span', {}, h('strong', {}, town.name), ' ', h('small', {}, formatDistance(town.distance))),
            h('button', {
                type: 'button', class: 'icon-btn', title: t('Add {name} to your wishlist', { name: town.name }), 'aria-label': t('Add {name} to your wishlist', { name: town.name }),
                onclick: async event => {
                    event.currentTarget.disabled = true;
                    try {
                        await ctx.savePlace({ lat: town.lat, lng: town.lng, name: `${town.name}, ${countryName(town.countryId)}`, category: 'City', ...statusFields('wishlist') });
                        event.target.closest('li')?.remove();
                    } catch (error) {
                        ctx.handleError(error);
                    }
                }
            }, '☆')))));
}

/**
 * The section, closed at first so the card keeps its height; opening it loads the towns
 * around. Only for a signed-in traveler's town been to.
 */
export function nearbySection(ctx, marker) {
    if (!ctx.state.user || statusOf(marker) === 'wishlist') return null;
    const body = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted small' }, t('Loading…')));
    let loaded = false;
    const details = h('details', { class: 'card-nearby' }, h('summary', {}, t('🚶 Towns next door')), body);
    details.addEventListener('toggle', () => {
        if (!details.open || loaded) return;
        loaded = true;
        import('./import-apps.js')
            .then(({ findTowns }) => findTowns(ctx))
            .then(({ townsAround }) => townsAround(Number(marker.lat), Number(marker.lng), { limit: 4, skip: town => saved(ctx, town) }))
            .then(towns => draw(ctx, body, towns))
            .catch(() => fill(body, h('p', { class: 'muted small' }, t('The towns around could not be loaded.'))));
    });
    return details;
}
