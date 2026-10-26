// Place search in the top bar: countries and big cities instantly in the browser, every town
// from the server a moment later, and the world geocoder for anything smaller. Also
// "Surprise me".
import { h, $, toast } from './ui.js';
import { searchCities } from './geo.js';
import { showCityCard, showCountryCard } from './cards.js';

const search = {
    input: null,
    list: null,
    results: [],
    active: -1
};

function searchResults(ctx, query, cities = searchCities(ctx.state.cities, query, 6)) {
    const countries = ctx.state.index.search(query, 5).map(country => ({ kind: 'country', country }));
    const results = [...countries, ...cities.map(city => ({ kind: 'city', city }))];
    if (query.trim().length >= 3) results.push({ kind: 'world', query: query.trim() });
    return results;
}

// Big cities are matched instantly in the browser; every smaller town comes from the
// server's index a moment later, replacing the city results if the query is unchanged.
let placeSearchTimer = 0;
function searchAllPlaces(ctx, query) {
    clearTimeout(placeSearchTimer);
    if (query.trim().length < 2) return;
    placeSearchTimer = setTimeout(async () => {
        try {
            const cities = await ctx.api.searchPlaces(query.trim());
            if (search.input.value !== query || !cities.length) return;
            search.results = searchResults(ctx, query, cities);
            search.active = Math.min(Math.max(search.active, 0), search.results.length - 1);
            renderSearchResults(ctx);
        } catch {
            // The instant results stay; the world search remains available.
        }
    }, 150);
}

function resultContent(result) {
    if (result.kind === 'country') {
        return [h('span', { class: 'result-icon' }, result.country.flag), h('span', {}, result.country.name), h('small', {}, result.country.continent)];
    }
    if (result.kind === 'city') {
        return [h('span', { class: 'result-icon' }, result.city.capital ? '★' : '●'), h('span', {}, result.city.name), h('small', {}, result.city.country)];
    }
    return [h('span', { class: 'result-icon' }, '🌐'), h('span', {}, `Search the world for “${result.query}”`)];
}

function renderSearchResults(ctx) {
    const { list, results } = search;
    list.replaceChildren(...results.map((result, i) => h('li', {
        id: `search-result-${i}`,
        role: 'option',
        class: i === search.active ? 'is-active' : '',
        'aria-selected': String(i === search.active),
        onmousedown: event => {
            event.preventDefault();
            chooseResult(ctx, result);
        }
    }, resultContent(result))));
    list.hidden = results.length === 0;
    search.input.setAttribute('aria-expanded', String(!list.hidden));
    search.input.setAttribute('aria-activedescendant', search.active >= 0 ? `search-result-${search.active}` : '');
}

async function searchWorld(ctx, query) {
    // The server-side geocoder covers towns that are not in the built-in city list.
    const [result] = await ctx.api.geocodeCity(query);
    if (!result) throw new Error(`No place called “${query}” was found.`);
    const name = result.city || result.name || query;
    const lat = Number(result.lat);
    const lng = Number(result.lng);
    const country = ctx.state.index.findAt(lat, lng);
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

async function chooseResult(ctx, result) {
    const { state, map } = ctx;
    search.input.value = '';
    search.results = [];
    search.active = -1;
    renderSearchResults(ctx);
    search.input.blur();

    // While picking countries, a search result picks its country.
    if (state.selection && result.kind !== 'world') {
        const country = result.kind === 'country' ? result.country : state.index.byId.get(result.city.countryId);
        ctx.toggleSelected(country);
        if (country) map.flyToCountry(country);
        return;
    }
    if (result.kind === 'country') {
        map.flyToCountry(result.country).then(() => showCountryCard(ctx, result.country));
    } else if (result.kind === 'city') {
        // Fly close enough for the town to be drawn on the map.
        const zoom = Math.min(11, Math.max(5.5, (result.city.minZoom ?? 5) + 0.5));
        map.flyTo(result.city.lat, result.city.lng, zoom).then(() => showCityCard(ctx, result.city));
    } else {
        try {
            const city = await searchWorld(ctx, result.query);
            map.flyTo(city.lat, city.lng, 6).then(() => showCityCard(ctx, city));
        } catch (error) {
            toast(error.message, { tone: 'error' });
        }
    }
}

export function setupSearch(ctx) {
    search.input = $('#global-search');
    search.list = $('#search-results');
    search.input.addEventListener('input', () => {
        search.results = searchResults(ctx, search.input.value);
        search.active = search.results.length ? 0 : -1;
        renderSearchResults(ctx);
        searchAllPlaces(ctx, search.input.value);
    });
    search.input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!search.results.length) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            search.active = (search.active + step + search.results.length) % search.results.length;
            renderSearchResults(ctx);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const result = search.results[search.active];
            if (result) chooseResult(ctx, result);
        } else if (event.key === 'Escape') {
            search.input.value = '';
            search.results = [];
            renderSearchResults(ctx);
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
    $('#surprise-btn').addEventListener('click', () => surprise(ctx));
}

// Flies to a country not visited yet, or half the time to a wishlist dream.
function surprise(ctx) {
    const { state } = ctx;
    const visited = state.stats?.visitedIds || new Set();
    const wishlist = state.stats?.wishlistIds || new Set();
    const bigEnough = state.index.countries.filter(country => country.population > 200000);
    const wished = bigEnough.filter(country => wishlist.has(country.id));
    const unvisited = bigEnough.filter(country => !visited.has(country.id));
    const pool = wished.length && Math.random() < 0.5 ? wished : unvisited.length ? unvisited : bigEnough;
    const country = pool[Math.floor(Math.random() * pool.length)];
    ctx.map.flyToCountry(country).then(() => showCountryCard(ctx, country));
}
