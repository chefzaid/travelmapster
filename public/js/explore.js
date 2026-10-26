// Explore tab: the greeting, next dream, continents and recent places, and the travel ideas
// from Wikivoyage, which also show beside the landing page and public maps.
import { h, $, fill } from './ui.js';
import { CONTINENTS, CONTINENT_EMOJI } from './geo.js';
import { monthsLabel, nextInSeason, priorityLabel } from './details.js';
import { statusOf } from './status.js';
import { shareLabel } from './lists.js';
import { fetchIdeas } from './ideas.js';
import { openNewTrip } from './trips.js';
import { showMarker, statusChip } from './cards.js';

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
        state.ideas = { destination, error: error.message || 'Could not load travel ideas.' };
    }
    if (state.user) ctx.renderActiveTab();
    else renderIdeasInto(ctx, signedOutContainer(ctx));
}

function ideasSection(ctx) {
    const { destination, ideas, loading, error } = ctx.state.ideas;
    const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close ideas', onclick: () => {
        ctx.state.ideas = null;
        $('.ideas-standalone')?.remove();
        ctx.renderActiveTab();
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
            ctx.state.user ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openNewTrip(ctx, destination) }, '🗓️ Plan a trip') : null
        ),
        h('p', { class: 'attribution' }, 'Travel content from ', h('a', { href: 'https://en.wikivoyage.org', target: '_blank', rel: 'noopener noreferrer' }, 'Wikivoyage'), ' (CC BY-SA).')
    );
}

function renderIdeasInto(ctx, container) {
    container.querySelector('.ideas-standalone')?.remove();
    if (!ctx.state.ideas) return;
    container.prepend(h('div', { class: 'ideas-standalone' }, ideasSection(ctx)));
}

// ---------------------------------------------------------------- explore tab

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
            h('h2', {}, `Hi ${state.user.username}! `, h('span', { 'aria-hidden': 'true' }, '👋')),
            h('p', { class: 'muted' }, stats.visitedCountries
                ? `You've colored in ${stats.visitedCountries} ${stats.visitedCountries === 1 ? 'country' : 'countries'}, ${stats.worldPercent}% ${shareLabel(stats.countryList)}.`
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
            h('h3', {}, nextDream.emoji ? `${nextDream.emoji} ` : '', nextDream.name),
            nextDream.bestMonths?.length ? h('p', { class: 'small' }, `Best ${monthsLabel(nextDream.bestMonths)}`,
                nextDream.priority ? ` · ${priorityLabel(nextDream.priority)}` : '') : null,
            h('div', { class: 'row' },
                h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => showMarker(ctx, nextDream) }, 'Show on map'),
                h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => openNewTrip(ctx, nextDream.name.split(',')[0]) }, 'Plan it')
            )
        ) : null,
        h('section', {},
            h('h3', { class: 'section-title' }, 'Jump to a continent'),
            h('div', { class: 'continent-grid' }, CONTINENTS.map(name => {
                const continent = stats.continents.find(item => item.name === name);
                const [center, zoom] = CONTINENT_VIEWS[name];
                return h('button', { type: 'button', class: 'continent-btn', onclick: () => ctx.map.flyToView(center, zoom) },
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
                return h('li', {}, h('button', { type: 'button', onclick: () => showMarker(ctx, marker) },
                    h('span', { 'aria-hidden': 'true' }, country?.flag || '📍'),
                    h('span', {}, marker.name),
                    statusChip(statusOf(marker))
                ));
            }))
        ) : null,
        h('p', { class: 'muted small tip' }, 'Tip: press ', h('kbd', {}, '/'), ' to search, zoom in to see more cities.')
    );
}
