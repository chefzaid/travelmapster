import { h, $, fill } from './ui.js';

function statTile(value, label, tone = '') {
    return h('div', { class: `stat ${tone}` }, h('strong', {}, value), h('small', {}, label));
}

function continentBars(stats) {
    return h('ul', { class: 'continent-bars' }, stats.continents.map(continent => h('li', {},
        h('span', { class: 'bar-label' }, h('span', { 'aria-hidden': 'true' }, continent.emoji), ` ${continent.name}`),
        h('span', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(continent.total), 'aria-valuenow': String(continent.visited), 'aria-label': `${continent.name}: ${continent.visited} of ${continent.total}` },
            h('span', { style: `width:${Math.max(continent.percent, continent.visited ? 4 : 0)}%` })),
        h('small', { class: 'bar-count' }, `${continent.visited}/${continent.total}`)
    )));
}

// Pseudo-random but stable tilt per country so stamps look hand-pressed.
function tilt(id) {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
    return (hash % 17) - 8;
}

function stamps(stats, index, onPick) {
    const visited = [...stats.visitedIds].map(id => index.byId.get(id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    if (!visited.length) {
        return h('p', { class: 'muted small' }, 'Your passport is empty. Every country you visit earns a stamp.');
    }
    return h('ul', { class: 'stamps' }, visited.map(country => h('li', {},
        h('button', {
            type: 'button',
            class: `stamp stamp-c${country.color || 1}`,
            style: `--tilt:${tilt(country.id)}deg`,
            title: country.name,
            onclick: () => onPick?.(country)
        },
            h('span', { class: 'stamp-flag', 'aria-hidden': 'true' }, country.flag),
            h('span', { class: 'stamp-name' }, country.name)
        )
    )));
}

function yearChart(stats) {
    if (!stats.years.length) return null;
    const max = Math.max(...stats.years.map(year => year.count));
    return h('section', {},
        h('h3', { class: 'section-title' }, 'Trips by year'),
        h('ul', { class: 'year-chart' }, stats.years.map(({ year, count }) => h('li', { title: `${year}: ${count} places` },
            h('span', { class: 'year-bar', style: `height:${Math.max(8, Math.round((count / max) * 100))}%` }, h('span', {}, count)),
            h('small', {}, `’${year.slice(2)}`)
        )))
    );
}

export function renderPublicStats(container, stats) {
    fill(container,
        h('p', { class: 'muted' }, `${stats.rank.title} · ${stats.worldPercent}% of the world`),
        h('div', { class: 'stat-grid' },
            statTile(stats.visitedCountries, 'countries', 'tone-visited'),
            statTile(stats.visitedContinents, 'continents'),
            statTile(stats.visitedCities, 'cities'),
            statTile(stats.wishlistCountries, 'on wishlist', 'tone-wishlist')
        ),
        continentBars(stats)
    );
}

export function renderPassport(container, ctx) {
    const { stats, index, user } = ctx.state;
    const next = stats.nextRank;
    const progress = next ? Math.round((stats.visitedCountries / next.min) * 100) : 100;
    const unlocked = stats.achievements.filter(a => a.unlocked).length;
    const isPublic = user.profileVisibility === 'public';

    fill(container,
        h('section', { class: 'passport-cover' },
            h('p', { class: 'eyebrow' }, 'Passport of'),
            h('h2', {}, user.username),
            h('p', { class: 'rank' }, `🏆 ${stats.rank.title}`),
            next ? h('div', { class: 'rank-progress' },
                h('span', { class: 'progress' }, h('span', { style: `width:${progress}%` })),
                h('small', {}, `${next.min - stats.visitedCountries} more ${next.min - stats.visitedCountries === 1 ? 'country' : 'countries'} to ${next.title}`)
            ) : h('small', {}, 'You have reached the top rank!')
        ),
        h('div', { class: 'stat-grid' },
            statTile(stats.visitedCountries, 'countries', 'tone-visited'),
            statTile(`${stats.worldPercent}%`, 'of the world'),
            statTile(`${stats.visitedContinents}/6`, 'continents'),
            statTile(stats.visitedCities, 'cities'),
            statTile(stats.wishlistCountries, 'dream countries', 'tone-wishlist'),
            statTile(ctx.state.trips.length, 'trips planned')
        ),
        h('section', {}, h('h3', { class: 'section-title' }, 'Continents'), continentBars(stats)),
        h('section', {},
            h('h3', { class: 'section-title' }, 'Stamps', h('span', { class: 'count' }, stats.visitedCountries)),
            stamps(stats, index, country => {
                ctx.map.flyToCountry(country);
            })
        ),
        h('section', {},
            h('h3', { class: 'section-title' }, 'Badges', h('span', { class: 'count' }, `${unlocked}/${stats.achievements.length}`)),
            h('ul', { class: 'badges' }, stats.achievements.map(badge => h('li', {
                class: `badge${badge.unlocked ? ' is-unlocked' : ''}`,
                title: `${badge.title}: ${badge.description}`
            },
                h('span', { class: 'badge-icon', 'aria-hidden': 'true' }, badge.unlocked ? badge.icon : '🔒'),
                h('strong', {}, badge.title),
                h('small', {}, badge.description),
                h('span', { class: 'visually-hidden' }, badge.unlocked ? 'Unlocked' : 'Locked')
            )))
        ),
        yearChart(stats),
        h('section', { class: 'share-card' },
            h('h3', {}, '🔗 Share your map'),
            h('p', { class: 'muted small' }, isPublic
                ? 'Your map is public. Anyone with the link can see your countries and cities (notes and photos stay private).'
                : 'Make your map public to share a read-only link with friends. Notes and photos stay private.'),
            h('button', {
                type: 'button',
                class: 'btn btn-sm btn-primary',
                onclick: () => {
                    if (isPublic) $('#copy-share-btn').click();
                    else $('#public-toggle').click();
                }
            }, isPublic ? 'Copy share link' : 'Make my map public')
        )
    );
}
