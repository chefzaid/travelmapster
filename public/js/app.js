import { api } from './api.js';
import { createCountryIndex, computeStats, searchCities, formatPopulation, CONTINENTS, CONTINENT_EMOJI, flagEmoji } from './geo.js';
import { createTravelMap } from './map.js';
import { h, $, $all, fill, toast, confirmDialog, formDialog } from './ui.js';
import { fetchIdeas } from './ideas.js';
import { renderPlaces } from './places.js';
import { renderTrips, openNewTrip } from './trips.js';
import { renderPassport, renderPublicStats } from './passport.js';
import { celebrate } from './confetti.js';

const state = {
    user: null,
    markers: [],
    trips: [],
    stats: null,
    index: null,
    cities: [],
    publicUser: null,
    filters: { visited: true, wishlist: true },
    activeTab: 'explore',
    ideas: null,
    unlocked: null
};

let travelMap;

// ---------------------------------------------------------------- data

async function loadMapData() {
    const [countries, cities] = await Promise.all([
        fetch('data/countries.geojson').then(res => res.json()),
        fetch('data/cities.json').then(res => res.json())
    ]);
    state.index = createCountryIndex(countries);
    state.cities = cities;
}

function capitalOf(country) {
    return state.cities.find(city => city.capital && city.countryId === country.id);
}

function markersForCountry(country) {
    return state.markers.filter(marker => state.stats?.markerCountry.get(marker.id)?.id === country.id);
}

function countryMarker(country) {
    return markersForCountry(country).find(marker => marker.category === 'Country');
}

function cityMarkerFor(city) {
    const label = `${city.name}, ${city.country}`.toLowerCase();
    return state.markers.find(marker => marker.category === 'City' && (
        marker.name.toLowerCase() === label ||
        (Math.abs(marker.lat - city.lat) < 0.15 && Math.abs(marker.lng - city.lng) < 0.15)
    ));
}

function visibleMarkers() {
    return state.markers.filter(marker => state.filters[marker.type]);
}

function refresh({ celebrateNew = true } = {}) {
    state.stats = computeStats(state.markers, state.index, { trips: state.trips.length });
    const filter = state.filters.visited && state.filters.wishlist ? 'all' : state.filters.visited ? 'visited' : state.filters.wishlist ? 'wishlist' : 'none';
    travelMap.setCountryStatus(state.stats, filter);
    travelMap.setPins(visibleMarkers());
    $('#legend-visited').textContent = state.stats.visitedCountries;
    $('#legend-wishlist').textContent = state.stats.wishlistCountries;

    const unlocked = new Set(state.stats.achievements.filter(a => a.unlocked).map(a => a.id));
    if (state.unlocked && celebrateNew) {
        const fresh = state.stats.achievements.filter(a => a.unlocked && !state.unlocked.has(a.id));
        for (const achievement of fresh) {
            celebrate();
            toast(`Badge unlocked: ${achievement.icon} ${achievement.title}!`, { tone: 'success', duration: 5000 });
        }
    }
    state.unlocked = unlocked;
    renderActiveTab();
}

async function reloadMarkers() {
    state.markers = await api.getMarkers();
    refresh();
}

// ---------------------------------------------------------------- saving places

async function savePlace(place, { quiet = false } = {}) {
    const created = await api.addMarker(place);
    const marker = { photoUrl: '', notes: '', travelDate: '', ...place, id: created.id };
    state.markers.push(marker);
    refresh();
    if (!quiet) {
        toast(`${place.type === 'visited' ? 'Stamped' : 'Wishlisted'} ${place.name}!`, { tone: 'success' });
    }
    return marker;
}

async function updatePlace(marker, changes) {
    const next = { ...marker, ...changes };
    await api.updateMarker(marker.id, next);
    Object.assign(marker, changes);
    refresh();
    return marker;
}

async function removePlace(marker) {
    await api.deleteMarker(marker.id);
    state.markers = state.markers.filter(item => item.id !== marker.id);
    refresh();
    toast(`Removed ${marker.name}.`, {
        action: {
            label: 'Undo',
            run: () => {
                const { id, ...place } = marker;
                savePlace(place, { quiet: true }).catch(error => toast(error.message, { tone: 'error' }));
            }
        }
    });
}

// Marks a country or city as visited or wishlist, toggling off when it already has that status.
async function setStatus(existing, place, type) {
    try {
        if (existing && existing.type === type) {
            await removePlace(existing);
        } else if (existing) {
            await updatePlace(existing, { type });
            toast(type === 'visited' ? `${existing.name}: been there! 🎉` : `${existing.name} moved to your wishlist.`, { tone: 'success' });
        } else {
            await savePlace({ ...place, type });
        }
    } catch (error) {
        handleError(error);
    }
}

async function editPlace(marker) {
    const values = await formDialog({
        title: `Edit ${marker.name}`,
        submitLabel: 'Save changes',
        fields: [
            { name: 'name', label: 'Name', value: marker.name, required: true, maxlength: 160 },
            { name: 'type', label: 'Status', type: 'select', value: marker.type, options: [
                { value: 'visited', label: '✓ Been there' },
                { value: 'wishlist', label: '♥ Wishlist' }
            ] },
            { name: 'travelDate', label: 'Travel date', type: 'date', value: marker.travelDate || '' },
            { name: 'notes', label: 'Notes', type: 'textarea', value: marker.notes || '', maxlength: 2000, placeholder: 'Favorite memory, tips, who you went with…' },
            { name: 'photoUrl', label: 'Photo link', type: 'url', value: marker.photoUrl || '', placeholder: 'https://…', hint: 'Link to a photo hosted anywhere (HTTP or HTTPS).' }
        ]
    });
    if (!values) return;
    try {
        await updatePlace(marker, {
            name: values.name.trim(),
            type: values.type,
            travelDate: values.travelDate,
            notes: values.notes.trim(),
            photoUrl: values.photoUrl.trim()
        });
        toast(`Saved ${marker.name}.`, { tone: 'success' });
        travelMap.closePopup();
    } catch (error) {
        handleError(error);
    }
}

function handleError(error) {
    if (error.status === 401) {
        toast('Your session expired. Please log in again.', { tone: 'error' });
        showSignedOut();
        return;
    }
    toast(error.message || 'Something went wrong.', { tone: 'error' });
}

// ---------------------------------------------------------------- map cards

function statusChip(type) {
    if (type === 'visited') return h('span', { class: 'chip chip-visited' }, '✓ Been there');
    if (type === 'wishlist') return h('span', { class: 'chip chip-wishlist' }, '♥ Wishlist');
    return h('span', { class: 'chip' }, 'Not yet');
}

function statusButtons(existing, place) {
    if (!state.user) {
        return state.publicUser ? null : h('p', { class: 'card-note' }, 'Log in to color this in on your map.');
    }
    const button = (type, label) => h('button', {
        type: 'button',
        class: `btn btn-sm ${type === 'visited' ? 'btn-visited' : 'btn-wishlist'}${existing?.type === type ? ' is-active' : ''}`,
        'aria-pressed': String(existing?.type === type),
        onclick: async () => {
            await setStatus(existing, place, type);
            reopenCard();
        }
    }, label);
    return h('div', { class: 'card-actions' },
        button('visited', '✓ Been there'),
        button('wishlist', '♥ Wishlist')
    );
}

function savedDetails(marker) {
    if (!marker) return null;
    return h('div', { class: 'card-saved' },
        marker.travelDate ? h('p', {}, '📅 ', new Date(`${marker.travelDate}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })) : null,
        marker.notes ? h('p', { class: 'card-notes' }, marker.notes) : null,
        marker.photoUrl ? h('a', { href: marker.photoUrl, target: '_blank', rel: 'noopener noreferrer', class: 'card-photo' },
            h('img', { src: marker.photoUrl, alt: `Photo of ${marker.name}`, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: event => event.target.replaceWith('📷 View photo') })
        ) : null,
        state.user ? h('div', { class: 'card-links' },
            h('button', { type: 'button', class: 'link-btn', onclick: () => editPlace(marker) }, '✏️ Edit details'),
            h('button', { type: 'button', class: 'link-btn danger', onclick: () => { travelMap.closePopup(); removePlace(marker).catch(handleError); } }, '🗑️ Remove')
        ) : null
    );
}

function ideaButtons(destination) {
    return h('div', { class: 'card-links' },
        h('button', { type: 'button', class: 'link-btn', onclick: () => showIdeas(destination) }, '💡 Travel ideas'),
        state.user ? h('button', { type: 'button', class: 'link-btn', onclick: () => { travelMap.closePopup(); openNewTrip(context, destination); } }, '🗓️ Plan a trip') : null
    );
}

let lastCard = null;

function reopenCard() {
    if (lastCard) lastCard();
}

function showCountryCard(country, latlng) {
    lastCard = () => showCountryCard(country, latlng);
    const existing = countryMarker(country);
    const derivedVisited = state.stats?.visitedIds.has(country.id);
    const capital = capitalOf(country);
    const cities = markersForCountry(country).filter(marker => marker.category === 'City');
    const place = { lat: country.label[0], lng: country.label[1], name: country.name, category: 'Country' };

    const card = h('article', { class: 'card' },
        h('header', { class: 'card-header' },
            h('span', { class: 'card-flag', 'aria-hidden': 'true' }, country.flag),
            h('div', {},
                h('h3', {}, country.name),
                h('p', { class: 'card-sub' }, `${CONTINENT_EMOJI[country.continent] || ''} ${country.subregion || country.continent}`)
            )
        ),
        h('div', { class: 'card-status' }, statusChip(existing?.type || (derivedVisited ? 'visited' : null)),
            !existing && derivedVisited ? h('small', { class: 'muted' }, 'via a city you visited') : null),
        h('dl', { class: 'card-facts' },
            capital ? [h('dt', {}, 'Capital'), h('dd', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => showCityCard(capital) }, `★ ${capital.name}`))] : null,
            h('dt', {}, 'Population'), h('dd', {}, formatPopulation(country.population))
        ),
        cities.length ? h('div', { class: 'card-cities' },
            h('p', { class: 'muted small' }, 'Your cities here'),
            h('div', { class: 'chip-row' }, cities.map(marker => h('button', {
                type: 'button',
                class: `chip chip-${marker.type}`,
                onclick: () => showSavedCityCard(marker)
            }, marker.name.split(',')[0])))
        ) : null,
        statusButtons(existing, place),
        savedDetails(existing),
        ideaButtons(country.name)
    );
    travelMap.openPopup(latlng || country.label, card);
    travelMap.pulseCountry(country.id);
}

function showCityCard(city) {
    lastCard = () => showCityCard(city);
    const existing = cityMarkerFor(city);
    const country = state.index.byId.get(city.countryId);
    const place = { lat: city.lat, lng: city.lng, name: `${city.name}, ${city.country}`, category: 'City' };
    const card = h('article', { class: 'card' },
        h('header', { class: 'card-header' },
            h('span', { class: 'card-flag', 'aria-hidden': 'true' }, country?.flag || '📍'),
            h('div', {},
                h('h3', {}, city.name),
                h('p', { class: 'card-sub' },
                    country ? h('button', { type: 'button', class: 'link-btn', onclick: () => showCountryCard(country) }, city.country) : city.country,
                    city.capital ? ' · ★ Capital' : '')
            )
        ),
        h('div', { class: 'card-status' }, statusChip(existing?.type)),
        h('dl', { class: 'card-facts' }, h('dt', {}, 'Population'), h('dd', {}, formatPopulation(city.population))),
        statusButtons(existing, place),
        savedDetails(existing),
        ideaButtons(city.name)
    );
    travelMap.openPopup([city.lat, city.lng], card, { offset: [0, -4] });
}

function showSavedCityCard(marker) {
    lastCard = () => {
        const current = state.markers.find(item => item.id === marker.id);
        if (current) showSavedCityCard(current);
        else travelMap.closePopup();
    };
    const country = state.stats?.markerCountry.get(marker.id);
    const [cityName] = marker.name.split(',');
    const place = { lat: marker.lat, lng: marker.lng, name: marker.name, category: 'City' };
    const card = h('article', { class: 'card' },
        h('header', { class: 'card-header' },
            h('span', { class: 'card-flag', 'aria-hidden': 'true' }, country?.flag || '📍'),
            h('div', {},
                h('h3', {}, cityName),
                h('p', { class: 'card-sub' }, country
                    ? h('button', { type: 'button', class: 'link-btn', onclick: () => showCountryCard(country) }, country.name)
                    : marker.name)
            )
        ),
        h('div', { class: 'card-status' }, statusChip(marker.type)),
        statusButtons(marker, place),
        savedDetails(marker),
        ideaButtons(cityName)
    );
    travelMap.openPopup([marker.lat, marker.lng], card, { offset: [0, -30] });
}

function showMarker(marker) {
    if (marker.category === 'City') {
        travelMap.flyTo(marker.lat, marker.lng, 5.5).then(() => showSavedCityCard(marker));
        return;
    }
    const country = state.stats?.markerCountry.get(marker.id);
    if (country) {
        travelMap.flyToCountry(country).then(() => showCountryCard(country));
    }
}

// ---------------------------------------------------------------- search

const search = {
    input: null,
    list: null,
    results: [],
    active: -1
};

function searchResults(query) {
    const countries = state.index.search(query, 5).map(country => ({ kind: 'country', country }));
    const cities = searchCities(state.cities, query, 6).map(city => ({ kind: 'city', city }));
    const results = [...countries, ...cities];
    if (query.trim().length >= 3) results.push({ kind: 'world', query: query.trim() });
    return results;
}

function renderSearchResults() {
    const { list, results } = search;
    list.replaceChildren(...results.map((result, i) => {
        let content;
        if (result.kind === 'country') {
            content = [h('span', { class: 'result-icon' }, result.country.flag), h('span', {}, result.country.name), h('small', {}, result.country.continent)];
        } else if (result.kind === 'city') {
            content = [h('span', { class: 'result-icon' }, result.city.capital ? '★' : '●'), h('span', {}, result.city.name), h('small', {}, result.city.country)];
        } else {
            content = [h('span', { class: 'result-icon' }, '🌐'), h('span', {}, `Search the world for “${result.query}”`)];
        }
        return h('li', {
            id: `search-result-${i}`,
            role: 'option',
            class: i === search.active ? 'is-active' : '',
            'aria-selected': String(i === search.active),
            onmousedown: event => {
                event.preventDefault();
                chooseResult(result);
            }
        }, content);
    }));
    list.hidden = results.length === 0;
    search.input.setAttribute('aria-expanded', String(!list.hidden));
    search.input.setAttribute('aria-activedescendant', search.active >= 0 ? `search-result-${search.active}` : '');
}

async function searchWorld(query) {
    // The server-side geocoder covers towns that are not in the built-in city list.
    const [result] = await api.geocodeCity(query);
    if (!result) throw new Error(`No place called “${query}” was found.`);
    const name = result.city || result.name || query;
    const lat = Number(result.lat);
    const lng = Number(result.lng);
    const country = state.index.findAt(lat, lng);
    return {
        name,
        country: country?.name || result.country || '',
        countryId: country?.id || '',
        capital: 0,
        population: 0,
        lat: Math.round(lat * 100) / 100,
        lng: Math.round(lng * 100) / 100
    };
}

async function chooseResult(result) {
    search.input.value = '';
    search.results = [];
    search.active = -1;
    renderSearchResults();
    search.input.blur();

    if (result.kind === 'country') {
        travelMap.flyToCountry(result.country).then(() => showCountryCard(result.country));
    } else if (result.kind === 'city') {
        travelMap.flyTo(result.city.lat, result.city.lng, 5.5).then(() => showCityCard(result.city));
    } else {
        try {
            const city = await searchWorld(result.query);
            travelMap.flyTo(city.lat, city.lng, 6).then(() => showCityCard(city));
        } catch (error) {
            toast(error.message, { tone: 'error' });
        }
    }
}

function setupSearch() {
    search.input = $('#global-search');
    search.list = $('#search-results');
    search.input.addEventListener('input', () => {
        search.results = searchResults(search.input.value);
        search.active = search.results.length ? 0 : -1;
        renderSearchResults();
    });
    search.input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!search.results.length) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            search.active = (search.active + step + search.results.length) % search.results.length;
            renderSearchResults();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const result = search.results[search.active];
            if (result) chooseResult(result);
        } else if (event.key === 'Escape') {
            search.input.value = '';
            search.results = [];
            renderSearchResults();
        }
    });
    search.input.addEventListener('blur', () => {
        setTimeout(() => {
            search.list.hidden = true;
            search.input.setAttribute('aria-expanded', 'false');
        }, 100);
    });
    document.addEventListener('keydown', event => {
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
        if (event.key === '/' && !typing) {
            event.preventDefault();
            search.input.focus();
        }
    });
}

// ---------------------------------------------------------------- surprise me

function surprise() {
    const visited = state.stats?.visitedIds || new Set();
    const wishlist = state.stats?.wishlistIds || new Set();
    const bigEnough = state.index.countries.filter(country => country.population > 200000);
    const wished = bigEnough.filter(country => wishlist.has(country.id));
    const unvisited = bigEnough.filter(country => !visited.has(country.id));
    // Half the time, nudge toward a wishlist dream.
    const pool = wished.length && Math.random() < 0.5 ? wished : unvisited.length ? unvisited : bigEnough;
    const country = pool[Math.floor(Math.random() * pool.length)];
    travelMap.flyToCountry(country).then(() => showCountryCard(country));
}

// ---------------------------------------------------------------- ideas

async function showIdeas(destination) {
    travelMap.closePopup();
    if (!state.user) {
        state.ideas = { destination, loading: true };
        renderIdeasInto(signedOutContainer(), true);
    } else {
        selectTab('explore');
        state.ideas = { destination, loading: true };
        renderActiveTab();
    }
    try {
        const ideas = await fetchIdeas(destination);
        if (state.ideas?.destination !== destination) return;
        state.ideas = { destination, ideas };
    } catch (error) {
        if (state.ideas?.destination !== destination) return;
        state.ideas = { destination, error: error.message || 'Could not load travel ideas.' };
    }
    if (state.user) renderActiveTab();
    else renderIdeasInto(signedOutContainer(), true);
}

function signedOutContainer() {
    return state.publicUser ? $('#public-view') : $('#welcome-view');
}

function ideasSection() {
    const { destination, ideas, loading, error } = state.ideas;
    const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close ideas', onclick: () => {
        state.ideas = null;
        $('.ideas-standalone')?.remove();
        renderActiveTab();
    } }, '✕');
    const header = h('div', { class: 'section-head' }, h('h2', {}, `💡 Ideas for ${destination}`), close);
    if (loading) return h('section', { class: 'ideas' }, header, h('p', { class: 'muted' }, 'Flipping through the guidebook…'));
    if (error) return h('section', { class: 'ideas' }, header, h('p', { class: 'form-error' }, error));

    const group = (title, icon, items) => items?.length ? h('div', { class: 'idea-group' },
        h('h3', {}, `${icon} ${title}`),
        h('ul', {}, items.slice(0, 6).map(item => h('li', {}, h('strong', {}, item.name), item.description ? h('span', {}, ` ${item.description}`) : null)))
    ) : null;

    const hasAny = ['see', 'do', 'eat', 'drink', 'destinations', 'related'].some(key => ideas[key]?.length);
    return h('section', { class: 'ideas' },
        header,
        ideas.summary ? h('p', { class: 'ideas-summary' }, ideas.summary) : null,
        group('Places to go', '🗺️', ideas.destinations),
        group('See', '👀', ideas.see),
        group('Do', '🎒', ideas.do),
        group('Eat', '🍜', ideas.eat),
        group('Drink', '🍹', ideas.drink),
        group('Related guides', '📚', ideas.related),
        hasAny ? null : h('p', { class: 'muted' }, 'No highlights found in the guide yet.'),
        h('div', { class: 'ideas-actions' },
            h('a', { class: 'btn btn-ghost btn-sm', href: ideas.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open full guide ↗'),
            state.user ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openNewTrip(context, destination) }, '🗓️ Plan a trip') : null
        ),
        h('p', { class: 'attribution' }, 'Travel content from ', h('a', { href: 'https://en.wikivoyage.org', target: '_blank', rel: 'noopener noreferrer' }, 'Wikivoyage'), ' (CC BY-SA).')
    );
}

function renderIdeasInto(container, standalone) {
    container.querySelector('.ideas-standalone')?.remove();
    if (!state.ideas) return;
    const wrapper = h('div', { class: standalone ? 'ideas-standalone' : '' }, ideasSection());
    container.prepend(wrapper);
}

// ---------------------------------------------------------------- explore tab

function renderExplore(container) {
    const stats = state.stats;
    const recent = [...state.markers].sort((a, b) => b.id - a.id).slice(0, 4);
    const wishlist = state.markers.filter(marker => marker.type === 'wishlist');
    const nextDream = wishlist[Math.floor(Date.now() / 86400000) % Math.max(wishlist.length, 1)];

    fill(container,
        state.ideas ? ideasSection() : null,
        h('section', { class: 'greeting' },
            h('p', { class: 'eyebrow' }, stats.rank.title),
            h('h2', {}, `Hi ${state.user.username}! `, h('span', { 'aria-hidden': 'true' }, '👋')),
            h('p', { class: 'muted' }, stats.visitedCountries
                ? `You've colored in ${stats.visitedCountries} ${stats.visitedCountries === 1 ? 'country' : 'countries'}, ${stats.worldPercent}% of the world.`
                : 'Click any country you have visited to color it in.')
        ),
        state.markers.length === 0 ? h('section', { class: 'onboarding' },
            h('h3', {}, 'Get started in three taps'),
            h('ol', {},
                h('li', {}, 'Click a country on the map.'),
                h('li', {}, 'Press ', h('strong', {}, '✓ Been there'), ' or ', h('strong', {}, '♥ Wishlist'), '.'),
                h('li', {}, 'Zoom in and pin the cities you loved.')
            )
        ) : null,
        nextDream ? h('section', { class: 'dream-card' },
            h('p', { class: 'eyebrow' }, 'Your next adventure?'),
            h('h3', {}, nextDream.name),
            h('div', { class: 'row' },
                h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => showMarker(nextDream) }, 'Show on map'),
                h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => openNewTrip(context, nextDream.name.split(',')[0]) }, 'Plan it')
            )
        ) : null,
        h('section', {},
            h('h3', { class: 'section-title' }, 'Jump to a continent'),
            h('div', { class: 'continent-grid' }, CONTINENTS.map(name => {
                const continent = stats.continents.find(item => item.name === name);
                return h('button', { type: 'button', class: 'continent-btn', onclick: () => flyToContinent(name) },
                    h('span', { class: 'continent-emoji', 'aria-hidden': 'true' }, CONTINENT_EMOJI[name]),
                    h('span', {}, name),
                    h('small', {}, `${continent.visited}/${continent.total}`)
                );
            }))
        ),
        recent.length ? h('section', {},
            h('h3', { class: 'section-title' }, 'Recently added'),
            h('ul', { class: 'mini-list' }, recent.map(marker => {
                const country = stats.markerCountry.get(marker.id);
                return h('li', {}, h('button', { type: 'button', onclick: () => showMarker(marker) },
                    h('span', { 'aria-hidden': 'true' }, country?.flag || '📍'),
                    h('span', {}, marker.name),
                    statusChip(marker.type)
                ));
            }))
        ) : null,
        h('p', { class: 'muted small tip' }, 'Tip: press ', h('kbd', {}, '/'), ' to search, zoom in to see more cities.')
    );
}

const CONTINENT_VIEWS = {
    Africa: [[2, 20], 3],
    Asia: [[34, 90], 2.5],
    Europe: [[52, 15], 3.5],
    'North America': [[45, -100], 2.5],
    Oceania: [[-22, 145], 3],
    'South America': [[-18, -60], 3]
};

function flyToContinent(name) {
    const [center, zoom] = CONTINENT_VIEWS[name];
    travelMap.map.flyTo(center, zoom, { duration: 0.8 });
}

// ---------------------------------------------------------------- tabs

const TAB_RENDERERS = {
    explore: container => renderExplore(container),
    places: container => renderPlaces(container, context),
    trips: container => renderTrips(container, context),
    passport: container => renderPassport(container, context)
};

function selectTab(name) {
    state.activeTab = name;
    for (const tab of $all('.tabs [role="tab"]')) {
        const selected = tab.id === `tab-${name}`;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
    }
    try {
        localStorage.setItem('travelmapster.tab', name);
    } catch {
        // Storage can be unavailable (private mode); the tab just won't be remembered.
    }
    renderActiveTab();
}

function renderActiveTab() {
    if (!state.user || !state.stats) return;
    const container = $(`#${state.activeTab}-tab`);
    const scroll = $('#panel').scrollTop;
    TAB_RENDERERS[state.activeTab](container);
    $('#panel').scrollTop = scroll;
}

function setupTabs() {
    const tabs = $all('.tabs [role="tab"]');
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab.id.replace('tab-', '')));
        tab.addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            next.focus();
            selectTab(next.id.replace('tab-', ''));
        });
    });
}

// ---------------------------------------------------------------- auth

let authMode = 'login';

function setAuthMode(mode) {
    authMode = mode;
    $('#tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('#tab-register').setAttribute('aria-selected', String(mode === 'register'));
    $('#auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create my map';
    $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-hint').hidden = mode === 'login';
    $('#auth-error').hidden = true;
}

function setupAuth() {
    $('#tab-login').addEventListener('click', () => setAuthMode('login'));
    $('#tab-register').addEventListener('click', () => setAuthMode('register'));
    setAuthMode('login');

    $('#auth-form').addEventListener('submit', async event => {
        event.preventDefault();
        const username = $('#auth-username').value.trim();
        const password = $('#auth-password').value;
        const errorBox = $('#auth-error');
        errorBox.hidden = true;
        if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
            errorBox.textContent = 'Usernames need 3 to 32 letters, digits, dots, dashes or underscores, and passwords 8+ characters.';
            errorBox.hidden = false;
            return;
        }
        const submit = $('#auth-submit');
        submit.disabled = true;
        try {
            if (authMode === 'register') {
                await api.register(username, password);
            }
            await api.login(username, password);
            $('#auth-password').value = '';
            await startSession();
            toast(authMode === 'register' ? 'Welcome aboard! Your map is ready. 🗺️' : `Welcome back, ${username}!`, { tone: 'success' });
        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
        } finally {
            submit.disabled = false;
        }
    });

    $('#logout-btn').addEventListener('click', async () => {
        try {
            await api.logout();
        } catch {
            // Logging out locally is still the right outcome.
        }
        closeAccountMenu();
        showSignedOut();
        toast('See you on your next trip! ✈️');
    });
}

function shareUrl() {
    return `${location.origin}/?u=${encodeURIComponent(state.user.username)}`;
}

function closeAccountMenu() {
    $('#account-menu').hidden = true;
    $('#account-btn').setAttribute('aria-expanded', 'false');
}

function setupAccountMenu() {
    const button = $('#account-btn');
    const menu = $('#account-menu');
    button.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', event => {
        if (!menu.hidden && !$('#account').contains(event.target)) closeAccountMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) {
            closeAccountMenu();
            button.focus();
        }
    });

    $('#public-toggle').addEventListener('change', async event => {
        const visibility = event.target.checked ? 'public' : 'private';
        try {
            await api.saveProfile(visibility);
            state.user.profileVisibility = visibility;
            $('#copy-share-btn').disabled = visibility !== 'public';
            toast(visibility === 'public' ? 'Your map is public. Share the link!' : 'Your map is private again.', { tone: 'success' });
        } catch (error) {
            event.target.checked = !event.target.checked;
            handleError(error);
        }
    });

    $('#copy-share-btn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(shareUrl());
            toast('Share link copied!', { tone: 'success' });
        } catch {
            toast(`Share link: ${shareUrl()}`);
        }
    });
}

function setView(name) {
    for (const view of ['welcome', 'main', 'public', 'loading']) {
        $(`#${view}-view`).hidden = view !== name;
    }
    $('#app').dataset.state = name;
}

function showSignedOut() {
    state.user = null;
    state.markers = [];
    state.trips = [];
    state.unlocked = null;
    state.ideas = null;
    $('#account').hidden = true;
    travelMap.closePopup();
    refresh({ celebrateNew: false });
    setView('welcome');
}

async function startSession() {
    const user = await api.currentUser();
    state.user = user;
    $('#account').hidden = false;
    $('#account-name').textContent = user.username;
    $('#avatar-initial').textContent = user.username.slice(0, 1).toUpperCase();
    $('#public-toggle').checked = user.profileVisibility === 'public';
    $('#copy-share-btn').disabled = user.profileVisibility !== 'public';

    const [markers, trips] = await Promise.all([api.getMarkers(), api.getTrips()]);
    state.markers = markers;
    state.trips = trips;
    state.unlocked = null;
    state.ideas = null;
    setView('main');
    let savedTab = 'explore';
    try {
        savedTab = localStorage.getItem('travelmapster.tab') || 'explore';
    } catch {
        // Ignore unavailable storage.
    }
    state.activeTab = TAB_RENDERERS[savedTab] ? savedTab : 'explore';
    refresh({ celebrateNew: false });
    selectTab(state.activeTab);
}

async function startPublicView(username) {
    try {
        const data = await api.getPublicMap(username);
        state.publicUser = data.username;
        state.markers = data.markers;
        refresh({ celebrateNew: false });
        $('#public-title').textContent = `${data.username}'s travel map`;
        renderPublicStats($('#public-stats'), state.stats);
        setView('public');
        document.title = `${data.username}'s travel map · TravelMapster`;
    } catch (error) {
        toast(error.message, { tone: 'error' });
        history.replaceState(null, '', '/');
        await boot();
    }
}

// ---------------------------------------------------------------- panel & legend

function setupPanel() {
    const handle = $('#panel-handle');
    handle.addEventListener('click', () => {
        const collapsed = $('#panel').classList.toggle('is-collapsed');
        handle.setAttribute('aria-expanded', String(!collapsed));
    });
}

function setupLegend() {
    for (const button of $all('.legend-item[data-filter]')) {
        button.addEventListener('click', () => {
            const key = button.dataset.filter;
            state.filters[key] = !state.filters[key];
            button.setAttribute('aria-pressed', String(state.filters[key]));
            refresh({ celebrateNew: false });
        });
    }
}

// Shared context passed to the tab modules.
const context = {
    state,
    get map() { return travelMap; },
    api,
    refresh,
    savePlace,
    updatePlace,
    removePlace,
    editPlace,
    showMarker,
    showIdeas,
    handleError,
    confirmDialog,
    selectTab,
    reloadMarkers,
    flagEmoji
};

// ---------------------------------------------------------------- boot

async function boot() {
    const username = new URLSearchParams(location.search).get('u');
    if (username) {
        await startPublicView(username);
        return;
    }
    try {
        await startSession();
    } catch {
        showSignedOut();
    }
}

async function init() {
    await loadMapData();
    travelMap = createTravelMap($('#map'), {
        index: state.index,
        cities: state.cities,
        onCountryClick: (country, latlng) => showCountryCard(country, latlng),
        onCityClick: city => showCityCard(city),
        onPinClick: marker => showSavedCityCard(marker)
    });
    setupSearch();
    setupTabs();
    setupAuth();
    setupAccountMenu();
    setupPanel();
    setupLegend();
    $('#surprise-btn').addEventListener('click', surprise);
    // On phones, tuck the bottom sheet away so map cards have room.
    travelMap.map.on('popupopen', () => {
        if (window.innerWidth <= 760) {
            $('#panel').classList.add('is-collapsed');
            $('#panel-handle').setAttribute('aria-expanded', 'false');
        }
    });
    await boot();
}

init().catch(error => {
    console.error(error);
    $('#loading-view').replaceChildren(h('p', { class: 'form-error' }, 'The map could not load. Please refresh the page.'));
});
