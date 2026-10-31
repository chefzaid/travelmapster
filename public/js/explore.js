// Explore tab: the greeting, the countdown to the next trip, memories, countries not seen for
// years and next door, next dream, continents and recent places, and the travel ideas from
// Wikivoyage, which also show beside the landing page and public maps.
import { h, $, fill } from './ui.js';
import { CONTINENTS, CONTINENT_EMOJI, regionName } from './geo.js';
import { monthsLabel, nextInSeason, priorityLabel } from './details.js';
import { statusOf } from './status.js';
import { shareLabel } from './lists.js';
import { fetchIdeas } from './ideas.js';
import { openNewTrip } from './trips.js';
import { showCountryCard, showMarker, statusChip } from './cards.js';
import { localToday } from './days.js';
import { longTimeNoSee, memoryLabel, onThisDay } from './memories.js';
import { countdownSection } from './trip-countdown.js';
import { oneBorderAway } from './borders.js';
import { formatList, t, tn, tParts } from './i18n.js';

// ---------------------------------------------------------------- ideas

function signedOutContainer(ctx) {
    return ctx.state.publicUser ? $('#public-view') : $('#welcome-view');
}

export async function showIdeas(ctx, destination) {
    const { state } = ctx;
    ctx.map.closePopup();
    state.ideas = { destination, loading: true };
    if (state.user) ctx.selectTab('explore');
    else renderIdeasInto(ctx, signedOutContainer(ctx));
    try {
        const ideas = await fetchIdeas(destination);
        if (state.ideas?.destination !== destination) return;
        state.ideas = { destination, ideas };
    } catch (error) {
        if (state.ideas?.destination !== destination) return;
        state.ideas = { destination, error: error.message || t('Could not load travel ideas.') };
    }
    if (state.user) ctx.renderActiveTab();
    else renderIdeasInto(ctx, signedOutContainer(ctx));
}

function ideasSection(ctx) {
    const { destination, ideas, loading, error } = ctx.state.ideas;
    const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Close ideas'), onclick: () => {
        ctx.state.ideas = null;
        $('.ideas-standalone')?.remove();
        ctx.renderActiveTab();
    } }, '✕');
    const header = h('div', { class: 'section-head' }, h('h2', {}, t('💡 Ideas for {destination}', { destination })), close);
    if (loading) return h('section', { class: 'ideas' }, header, h('p', { class: 'muted' }, t('Flipping through the guidebook…')));
    if (error) return h('section', { class: 'ideas' }, header, h('p', { class: 'form-error' }, error));

    const group = (title, icon, items) => items?.length ? h('div', { class: 'idea-group' },
        h('h3', {}, `${icon} ${title}`),
        h('ul', {}, items.slice(0, 6).map(item => h('li', {}, h('strong', {}, item.name), item.description ? h('span', {}, ` ${item.description}`) : null)))
    ) : null;

    const hasAny = ['see', 'do', 'eat', 'drink', 'destinations', 'related'].some(key => ideas[key]?.length);
    return h('section', { class: 'ideas' },
        header,
        ideas.summary ? h('p', { class: 'ideas-summary' }, ideas.summary) : null,
        group(t('Places to go'), '🗺️', ideas.destinations),
        group(t('See'), '👀', ideas.see),
        group(t('Do'), '🎒', ideas.do),
        group(t('Eat'), '🍜', ideas.eat),
        group(t('Drink'), '🍹', ideas.drink),
        group(t('Related guides'), '📚', ideas.related),
        hasAny ? null : h('p', { class: 'muted' }, t('No highlights found in the guide yet.')),
        h('div', { class: 'ideas-actions' },
            h('a', { class: 'btn btn-ghost btn-sm', href: ideas.url, target: '_blank', rel: 'noopener noreferrer' }, t('Open full guide ↗')),
            ctx.state.user ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openNewTrip(ctx, destination) }, t('🗓️ Plan a trip')) : null
        ),
        h('p', { class: 'attribution' }, tParts('Travel content from {source} (CC BY-SA).', { source: h('a', { href: 'https://en.wikivoyage.org', target: '_blank', rel: 'noopener noreferrer' }, 'Wikivoyage') }))
    );
}

function renderIdeasInto(ctx, container) {
    container.querySelector('.ideas-standalone')?.remove();
    if (!ctx.state.ideas) return;
    container.prepend(h('div', { class: 'ideas-standalone' }, ideasSection(ctx)));
}

// ---------------------------------------------------------------- explore tab

// Visits that began on this day in earlier years, each a button that shows the place.
function memoriesSection(ctx) {
    const memories = onThisDay(ctx.state.markers, localToday());
    if (!memories.length) return null;
    return h('section', { 'aria-labelledby': 'memories-title' },
        h('h3', { class: 'section-title', id: 'memories-title' }, h('span', { 'aria-hidden': 'true' }, '📸 '), t('On this day')),
        h('ul', { class: 'mini-list', id: 'memories' }, memories.slice(0, 5).map(memory => {
            const country = ctx.state.stats.markerCountry.get(memory.marker.id);
            return h('li', {}, h('button', { type: 'button', onclick: () => showMarker(ctx, memory.marker) },
                h('span', { 'aria-hidden': 'true' }, country?.flag || '📍'),
                h('span', {}, memoryLabel(memory)),
                h('small', { class: 'muted' }, memory.visit.startDate.slice(0, 4))
            ));
        }))
    );
}

// Countries not seen for years, each a button that shows the country: a gentle "go back".
function longAgoSection(ctx) {
    const { state } = ctx;
    const list = longTimeNoSee(state.markers, {
        today: localToday(), countryOf: marker => state.stats.markerCountry.get(marker.id), homeId: state.stats.homeId
    });
    if (!list.length) return null;
    return h('section', { 'aria-labelledby': 'long-ago-title' },
        h('h3', { class: 'section-title', id: 'long-ago-title' }, h('span', { 'aria-hidden': 'true' }, '👋 '), t('Long time no see')),
        h('ul', { class: 'mini-list', id: 'long-ago' }, list.slice(0, 5).map(({ country, last, places }) => h('li', {},
            h('button', { type: 'button', onclick: () => ctx.map.flyToCountry(country).then(() => showCountryCard(ctx, country)) },
                h('span', { 'aria-hidden': 'true' }, country.flag),
                h('span', {}, places.length ? t('{country} ({places})', { country: country.name, places: formatList(places) }) : country.name),
                h('small', { class: 'muted' }, t('Last there in {year}', { year: last.slice(0, 4) }))
            ))))
    );
}

// Countries next to those been to, as easy next trips.
function nextDoorSection(ctx) {
    const { state } = ctx;
    const list = oneBorderAway(state.index.countries, state.stats.visitedIds);
    if (!list.length) return null;
    return h('section', { 'aria-labelledby': 'next-door-title' },
        h('h3', { class: 'section-title', id: 'next-door-title' }, h('span', { 'aria-hidden': 'true' }, '🧭 '), t('One border away')),
        h('ul', { class: 'mini-list', id: 'next-door' }, list.slice(0, 5).map(({ country, via }) => h('li', {},
            h('button', { type: 'button', onclick: () => ctx.map.flyToCountry(country).then(() => showCountryCard(ctx, country)) },
                h('span', { 'aria-hidden': 'true' }, country.flag),
                h('span', {}, country.name),
                h('small', { class: 'muted' }, t('Next to {countries}', { countries: formatList(via.slice(0, 3).map(item => item.name)) }))
            ))))
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

export function renderExplore(container, ctx) {
    const { state } = ctx;
    const stats = state.stats;
    const recent = [...state.markers].sort((a, b) => b.id - a.id).slice(0, 4);
    const wishlist = state.markers.filter(marker => marker.type === 'wishlist');
    // The wishlist place in season soonest, or a different dream every day.
    const month = new Date().getMonth() + 1;
    const nextDream = nextInSeason(wishlist, month) || wishlist[Math.floor(Date.now() / 86400000) % Math.max(wishlist.length, 1)];

    fill(container,
        state.ideas ? ideasSection(ctx) : null,
        h('section', { class: 'greeting' },
            h('p', { class: 'eyebrow' }, stats.rank.title),
            h('h2', {}, t('Hi {username}!', { username: state.user.username }), ' ', h('span', { 'aria-hidden': 'true' }, '👋')),
            h('p', { class: 'muted' }, stats.visitedCountries
                ? tn(stats.visitedCountries, 'You\'ve colored in {count} country, {percent}% {share}.', 'You\'ve colored in {count} countries, {percent}% {share}.', { percent: stats.worldPercent, share: shareLabel(stats.countryList) })
                : t('Click any country you have visited to color it in.'))
        ),
        countdownSection(ctx),
        state.markers.length === 0 ? h('section', { class: 'onboarding' },
            h('h3', {}, t('Get started in three taps')),
            h('ol', {},
                h('li', {}, t('Click a country on the map.')),
                h('li', {}, tParts('Press {visited} or {wishlist}.', { visited: h('strong', {}, t('✓ Been there')), wishlist: h('strong', {}, t('♥ Wishlist')) })),
                h('li', {}, t('Zoom in and pin the cities you loved.'))
            )
        ) : null,
        memoriesSection(ctx),
        longAgoSection(ctx),
        nextDoorSection(ctx),
        nextDream ? h('section', { class: 'dream-card' },
            h('p', { class: 'eyebrow' }, t('Your next adventure?')),
            h('h3', {}, nextDream.emoji ? `${nextDream.emoji} ` : '', nextDream.name),
            nextDream.bestMonths?.length ? h('p', { class: 'small' }, t('Best {bestMonths}', { bestMonths: monthsLabel(nextDream.bestMonths) }),
                nextDream.priority ? ` · ${priorityLabel(nextDream.priority)}` : '') : null,
            h('div', { class: 'row' },
                h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => showMarker(ctx, nextDream) }, t('Show on map')),
                h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => openNewTrip(ctx, nextDream.name.split(',')[0]) }, t('Plan it'))
            )
        ) : null,
        h('section', {},
            h('h3', { class: 'section-title' }, t('Jump to a continent')),
            h('div', { class: 'continent-grid' }, CONTINENTS.map(name => {
                const continent = stats.continents.find(item => item.name === name);
                const [center, zoom] = CONTINENT_VIEWS[name];
                return h('button', { type: 'button', class: 'continent-btn', onclick: () => ctx.map.flyToView(center, zoom) },
                    h('span', { class: 'continent-emoji', 'aria-hidden': 'true' }, CONTINENT_EMOJI[name]),
                    h('span', {}, regionName(name)),
                    h('small', {}, `${continent.visited}/${continent.total}`)
                );
            }))
        ),
        recent.length ? h('section', {},
            h('h3', { class: 'section-title' }, t('Recently added')),
            h('ul', { class: 'mini-list' }, recent.map(marker => {
                const country = stats.markerCountry.get(marker.id);
                return h('li', {}, h('button', { type: 'button', onclick: () => showMarker(ctx, marker) },
                    h('span', { 'aria-hidden': 'true' }, country?.flag || '📍'),
                    h('span', {}, marker.name),
                    statusChip(statusOf(marker))
                ));
            }))
        ) : null,
        h('p', { class: 'muted small tip' }, tParts('Tip: press {key} to search, {help} for every shortcut, and zoom in to see more cities.', { key: h('kbd', {}, '/'), help: h('kbd', {}, '?') }))
    );
}
