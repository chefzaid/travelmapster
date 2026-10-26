'use strict';

// Shared maps as links (ADR 0023): the page title and link-preview tags of a public map, and its
// preview picture. Counted with the browser's own modules (geo.js, poster.js) from the same
// places the public map shows; the home country stays private, as on the map.
const crypto = require('node:crypto');
const { createMapImage } = require('./map-image');
const { browserModule, countryData } = require('./browser-modules');
const { USERNAME_PATTERN } = require('./validation');

const IMAGE_CACHE_SIZE = 64;

function createPublicMaps({ users, markers, publicDir }) {
    let loading = null;
    // Pictures by the colours they paint, most recently used last.
    const images = new Map();

    // The country index and the map layout, loaded on the first shared map.
    function load() {
        loading ??= (async () => {
            const [{ computeStats }, { POSTER_STYLES, equalEarth, mapStatusOf }, { geojson, index }] = await Promise.all([
                browserModule('geo.js', publicDir), browserModule('poster.js', publicDir), countryData(publicDir)
            ]);
            const colors = POSTER_STYLES.cartoon;
            return {
                index,
                computeStats,
                mapStatusOf,
                colors,
                image: createMapImage(geojson.features, equalEarth, { background: colors.background, border: colors.border })
            };
        })();
        loading.catch(() => { loading = null; });
        return loading;
    }

    /** A public map by its owner's name: the owner and the passport counts; null when not shared. */
    async function find(username) {
        if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return null;
        const user = await users.findByUsername(username);
        if (!user || user.profile_visibility !== 'public') return null;
        const { index, computeStats } = await load();
        const stats = computeStats(await markers.listPublic(user.id), index, { countryList: user.country_list || 'all' });
        return { user, stats };
    }

    /** The page's title, description, link-preview picture and address. */
    function meta({ user, stats }, origin) {
        const name = user.username;
        const countries = `${stats.visitedCountries} ${stats.visitedCountries === 1 ? 'country' : 'countries'}`;
        const cities = stats.visitedCities ? `, ${stats.visitedCities} ${stats.visitedCities === 1 ? 'city' : 'cities'}` : '';
        return {
            title: `${name}'s travel map · TravelMapster`,
            description: `${countries} been to (${stats.worldPercent}% of the world)${cities}. Make your own travel map on TravelMapster.`,
            url: `${origin}/?u=${encodeURIComponent(name)}`,
            image: `${origin}/og/${encodeURIComponent(name)}.png`,
            imageAlt: `${name}'s travel map: the countries they have been to, colored in on a world map`,
            indexed: Boolean(user.public_indexing)
        };
    }

    /** The map's preview picture as PNG, with an ETag that changes with its colours. */
    async function image({ stats }) {
        const { mapStatusOf, colors, image: map } = await load();
        const statusOf = mapStatusOf({ ...stats, homeId: null });
        const fillOf = feature => colors[statusOf(feature.properties.id)] || colors.land;
        const etag = `"${crypto.createHash('sha256').update(map.features.map(fillOf).join('')).digest('base64url').slice(0, 22)}"`;
        let png = images.get(etag);
        if (png) images.delete(etag);
        else png = map.render(fillOf);
        images.set(etag, png);
        if (images.size > IMAGE_CACHE_SIZE) images.delete(images.keys().next().value);
        return { png, etag };
    }

    return { find, meta, image };
}

module.exports = { createPublicMaps };
