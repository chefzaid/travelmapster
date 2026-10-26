// Map cards for countries and cities: status buttons, saved details, visits, the home country
// and links to travel ideas and trip planning.
import { h, toast } from './ui.js';
import { countryLook, countryStatus, formatPopulation, CONTINENT_EMOJI } from './geo.js';
import { monthsLabel, priorityLabel, ratingLabel, stars } from './details.js';
import { HOME, STATUSES, statusFields, statusLabel, statusOf } from './status.js';
import { openNewTrip } from './trips.js';
import { visitsSection } from './card-visits.js';

// ---------------------------------------------------------------- saved places on the map

export function markersForCountry(ctx, country) {
    return ctx.state.markers.filter(marker => ctx.state.stats?.markerCountry.get(marker.id)?.id === country.id);
}

export function countryMarker(ctx, country) {
    return markersForCountry(ctx, country).find(marker => marker.category === 'Country');
}

function capitalOf(ctx, country) {
    return ctx.state.cities.find(city => city.capital && city.countryId === country.id);
}

function cityMarkerFor(ctx, city) {
    const label = `${city.name}, ${city.country}`.toLowerCase();
    return ctx.state.markers.find(marker => marker.category === 'City' && (
        marker.name.toLowerCase() === label ||
        (Math.abs(marker.lat - city.lat) < 0.15 && Math.abs(marker.lng - city.lng) < 0.15)
    ));
}

// ---------------------------------------------------------------- statuses

const STATUS_TOASTS = {
    visited: name => `${name}: been there! 🎉`,
    lived: name => `${name}: lived there! 🔑`,
    transit: name => `${name}: transit only, not counted as a visit.`,
    wishlist: name => `${name} moved to your wishlist.`
};

// Marks a country or city with a status (ADR 0014), toggling off when it already has it.
async function setStatus(ctx, existing, place, status) {
    try {
        if (existing && statusOf(existing) === status) {
            await ctx.removePlace(existing);
        } else if (existing) {
            await ctx.updatePlace(existing, statusFields(status));
            toast(STATUS_TOASTS[status](existing.name), { tone: 'success' });
        } else {
            await ctx.savePlace({ ...place, ...statusFields(status) });
        }
    } catch (error) {
        ctx.handleError(error);
    }
}

export function statusChip(status) {
    if (status === 'home') return h('span', { class: 'chip chip-home' }, `${HOME.icon} ${HOME.label}`);
    if (!status) return h('span', { class: 'chip' }, 'Not yet');
    return h('span', { class: `chip chip-${status}` }, statusLabel(status));
}

function statusButtons(ctx, existing, place) {
    const { state } = ctx;
    if (state.publicUser) return null;
    if (!state.user && !state.demo) return h('p', { class: 'card-note' }, 'Log in to color this in on your map.');
    const current = existing ? statusOf(existing) : null;
    const button = ({ id }) => h('button', {
        type: 'button',
        class: `btn btn-sm btn-${id}${current === id ? ' is-active' : ''}`,
        'aria-pressed': String(current === id),
        onclick: async () => {
            await setStatus(ctx, existing, place, id);
            reopenCard();
        }
    }, statusLabel(id));
    return [
        h('div', { class: 'card-actions' }, STATUSES.map(button)),
        state.demo ? h('p', { class: 'card-note' }, 'Demo map: nothing is saved. Sign up to keep your own.') : null
    ];
}

// ---------------------------------------------------------------- saved details

// Rating, emoji, tags and wishlist plans of a saved place, shown when it has any.
function detailsRow(marker) {
    const tags = marker.tags || [];
    const months = marker.type === 'wishlist' ? monthsLabel(marker.bestMonths) : '';
    const priority = marker.type === 'wishlist' ? priorityLabel(marker.priority) : '';
    if (!marker.rating && !marker.emoji && !tags.length && !months && !priority) return null;
    return h('div', { class: 'card-details' },
        priority ? h('span', { class: 'chip chip-wishlist' }, priority) : null,
        months ? h('span', { class: 'card-months' }, h('span', { 'aria-hidden': 'true' }, '📅 '), `Best ${months}`) : null,
        marker.emoji ? h('span', { class: 'card-emoji', title: 'Pin emoji' }, marker.emoji) : null,
        marker.rating ? h('span', { class: 'stars' },
            h('span', { 'aria-hidden': 'true' }, stars(marker.rating)),
            h('span', { class: 'visually-hidden' }, ratingLabel(marker.rating))) : null,
        tags.length ? h('ul', { class: 'tag-list', 'aria-label': 'Tags' }, tags.map(tag => h('li', { class: 'tag' }, `#${tag}`))) : null
    );
}

function savedDetails(ctx, marker) {
    if (!marker) return null;
    const signedIn = Boolean(ctx.state.user);
    return h('div', { class: 'card-saved' },
        detailsRow(marker),
        visitsSection(ctx, marker, reopenCard),
        marker.notes ? h('p', { class: 'card-notes' }, marker.notes) : null,
        marker.photoUrl ? h('a', { href: marker.photoUrl, target: '_blank', rel: 'noopener noreferrer', class: 'card-photo' },
            h('img', { src: marker.photoUrl, alt: `Photo of ${marker.name}`, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: event => event.target.replaceWith('📷 View photo') })
        ) : null,
        signedIn && marker.hideFromPublic ? h('p', { class: 'card-note' }, h('span', { 'aria-hidden': 'true' }, '🔒 '), 'Hidden from your public map') : null,
        signedIn ? h('div', { class: 'card-links' },
            h('button', { type: 'button', class: 'link-btn', onclick: () => ctx.editPlace(marker) }, '✏️ Edit details'),
            h('button', { type: 'button', class: 'link-btn danger', onclick: () => { ctx.map.closePopup(); ctx.removePlace(marker).catch(ctx.handleError); } }, '🗑️ Remove')
        ) : null
    );
}

function ideaButtons(ctx, destination) {
    return h('div', { class: 'card-links' },
        h('button', { type: 'button', class: 'link-btn', onclick: () => ctx.showIdeas(destination) }, '💡 Travel ideas'),
        ctx.state.user ? h('button', { type: 'button', class: 'link-btn', onclick: () => { ctx.map.closePopup(); openNewTrip(ctx, destination); } }, '🗓️ Plan a trip') : null
    );
}

// ---------------------------------------------------------------- cards

let lastCard = null;

function reopenCard() {
    if (lastCard) lastCard();
}

// A country saved through a city takes the city's status; the note says so.
const DERIVED_NOTES = { visited: 'via a city you visited', lived: 'via a city you lived in', transit: 'via a city you passed through' };
const LOOK_STATUS = { cityOnly: 'visited', visited: 'visited', lived: 'lived', transit: 'transit' };

function countryStatusRow(ctx, country, existing) {
    const { stats } = ctx.state;
    const isHome = stats?.homeId === country.id;
    const cities = existing ? [] : markersForCountry(ctx, country);
    const derived = cities.length
        ? LOOK_STATUS[countryLook(country.id, countryStatus(cities, marker => stats.markerCountry.get(marker.id)))]
        : null;
    return h('div', { class: 'card-status' },
        isHome ? statusChip('home') : null,
        existing || derived || !isHome ? statusChip(existing ? statusOf(existing) : derived) : null,
        derived ? h('small', { class: 'muted' }, DERIVED_NOTES[derived]) : null);
}

// Signed-in travelers set their home country from its card, or in the settings.
function homeButton(ctx, country) {
    const { user } = ctx.state;
    if (!user) return null;
    const isHome = user.homeCountry === country.id;
    return h('div', { class: 'card-links' }, h('button', {
        type: 'button',
        class: 'link-btn',
        onclick: async () => {
            await ctx.saveSettings({ homeCountry: isHome ? null : country.id },
                isHome ? 'Home country cleared.' : `${country.name} is your home country. 🏠`);
            reopenCard();
        }
    }, isHome ? '🏠 Not my home country any more' : '🏠 Make this my home country'));
}

function cardHeader(flag, title, sub) {
    return h('header', { class: 'card-header' },
        h('span', { class: 'card-flag', 'aria-hidden': 'true' }, flag),
        h('div', {}, h('h3', {}, title), h('p', { class: 'card-sub' }, sub)));
}

function countryLink(ctx, country, label) {
    return h('button', { type: 'button', class: 'link-btn', onclick: () => showCountryCard(ctx, country) }, label);
}

export function showCountryCard(ctx, country, latlng) {
    lastCard = () => showCountryCard(ctx, country, latlng);
    const existing = countryMarker(ctx, country);
    const capital = capitalOf(ctx, country);
    const cities = markersForCountry(ctx, country).filter(marker => marker.category === 'City');
    const place = { lat: country.label[0], lng: country.label[1], name: country.name, category: 'Country' };

    const card = h('article', { class: 'card' },
        cardHeader(country.flag, country.name, `${CONTINENT_EMOJI[country.continent] || ''} ${country.subregion || country.continent}`),
        countryStatusRow(ctx, country, existing),
        h('dl', { class: 'card-facts' },
            capital ? [h('dt', {}, 'Capital'), h('dd', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => showCityCard(ctx, capital) }, `★ ${capital.name}`))] : null,
            h('dt', {}, 'Population'), h('dd', {}, formatPopulation(country.population))
        ),
        cities.length ? h('div', { class: 'card-cities' },
            h('p', { class: 'muted small' }, 'Your cities here'),
            h('div', { class: 'chip-row' }, cities.map(marker => h('button', {
                type: 'button',
                class: `chip chip-${statusOf(marker)}`,
                onclick: () => showSavedCityCard(ctx, marker)
            }, marker.name.split(',')[0])))
        ) : null,
        statusButtons(ctx, existing, place),
        savedDetails(ctx, existing),
        homeButton(ctx, country),
        ideaButtons(ctx, country.name)
    );
    ctx.map.openPopup(latlng || country.label, card);
    ctx.map.pulseCountry(country.id);
}

export function showCityCard(ctx, city) {
    lastCard = () => showCityCard(ctx, city);
    const existing = cityMarkerFor(ctx, city);
    const country = ctx.state.index.byId.get(city.countryId);
    const place = { lat: city.lat, lng: city.lng, name: `${city.name}, ${city.country}`, category: 'City' };
    const card = h('article', { class: 'card' },
        cardHeader(country?.flag || '📍', city.name,
            [country ? countryLink(ctx, country, city.country) : city.country, city.capital ? ' · ★ Capital' : '']),
        h('div', { class: 'card-status' }, statusChip(existing ? statusOf(existing) : null)),
        h('dl', { class: 'card-facts' }, h('dt', {}, 'Population'), h('dd', {}, formatPopulation(city.population))),
        statusButtons(ctx, existing, place),
        savedDetails(ctx, existing),
        ideaButtons(ctx, city.name)
    );
    ctx.map.openPopup([city.lat, city.lng], card, { offset: [0, -4] });
}

export function showSavedCityCard(ctx, marker) {
    lastCard = () => {
        const current = ctx.state.markers.find(item => item.id === marker.id);
        if (current) showSavedCityCard(ctx, current);
        else ctx.map.closePopup();
    };
    const country = ctx.state.stats?.markerCountry.get(marker.id);
    const [cityName] = marker.name.split(',');
    const place = { lat: marker.lat, lng: marker.lng, name: marker.name, category: 'City' };
    const card = h('article', { class: 'card' },
        cardHeader(country?.flag || '📍', cityName, country ? countryLink(ctx, country, country.name) : marker.name),
        h('div', { class: 'card-status' }, statusChip(statusOf(marker))),
        statusButtons(ctx, marker, place),
        savedDetails(ctx, marker),
        ideaButtons(ctx, cityName)
    );
    ctx.map.openPopup([marker.lat, marker.lng], card, { offset: [0, -30] });
}

export function showMarker(ctx, marker) {
    if (marker.category === 'City') {
        ctx.map.flyTo(marker.lat, marker.lng, 5.5).then(() => showSavedCityCard(ctx, marker));
        return;
    }
    const country = ctx.state.stats?.markerCountry.get(marker.id);
    if (country) ctx.map.flyToCountry(country).then(() => showCountryCard(ctx, country));
}
