import { h, $, fill } from './ui.js';
import { HOME } from './status.js';
import { countryList, shareLabel } from './lists.js';

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

// The home country and countries lived in carry a ribbon on their stamp (ADR 0014).
function stampRibbon(stats, id) {
    if (id === stats.homeId) return `${HOME.icon} Home`;
    return stats.livedIds.has(id) ? '🔑 Lived' : '';
}

function stamps(stats, index, onPick) {
    const visited = [...stats.visitedIds].filter(id => stats.countedIds.has(id)).map(id => index.byId.get(id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    if (!visited.length) {
        return h('p', { class: 'muted small' }, 'Your passport is empty. Every country you visit earns a stamp.');
    }
    return h('ul', { class: 'stamps' }, visited.map(country => {
        const ribbon = stampRibbon(stats, country.id);
        return h('li', {},
            h('button', {
                type: 'button',
                class: `stamp stamp-c${country.color || 1}`,
                style: `--tilt:${tilt(country.id)}deg`,
                title: ribbon ? `${country.name} (${ribbon.slice(ribbon.indexOf(' ') + 1).toLowerCase()})` : country.name,
                onclick: () => onPick?.(country)
            },
                h('span', { class: 'stamp-flag', 'aria-hidden': 'true' }, country.flag),
                h('span', { class: 'stamp-name' }, country.name),
                ribbon ? h('span', { class: 'stamp-ribbon' }, ribbon) : null
            )
        );
    }));
}

// Territories been to that the chosen list leaves out are named, not stamped.
function uncountedNote(stats, index) {
    const names = stats.uncountedIds.map(id => index.byId.get(id)?.name).filter(Boolean).sort();
    if (!names.length) return null;
    return h('p', { class: 'muted small' }, h('span', { 'aria-hidden': 'true' }, '🗺️ '),
        `Also been to, not on the ${countryList(stats.countryList).unit} list: ${names.join(', ')}.`);
}

// Layovers are listed but never stamped: they are not visits.
function transitNote(stats, index) {
    const names = [...stats.transitIds].map(id => index.byId.get(id)?.name).filter(Boolean).sort();
    if (!names.length) return null;
    return h('p', { class: 'muted small' }, h('span', { 'aria-hidden': 'true' }, '🛫 '),
        `Transit only, not counted: ${names.join(', ')}.`);
}

function yearChart(stats) {
    if (!stats.years.length) return null;
    const max = Math.max(...stats.years.map(year => year.count));
    return h('section', {},
        h('h3', { class: 'section-title' }, 'Visits by year'),
        h('ul', { class: 'year-chart' }, stats.years.map(({ year, count }) => h('li', { title: `${year}: ${count} ${count === 1 ? 'visit' : 'visits'}` },
            h('span', { class: 'year-bar', style: `height:${Math.max(8, Math.round((count / max) * 100))}%` }, h('span', {}, count)),
            h('small', {}, `’${year.slice(2)}`)
        )))
    );
}

export function renderPublicStats(container, stats) {
    fill(container,
        h('p', { class: 'muted' }, `${stats.rank.title} · ${stats.worldPercent}% ${shareLabel(stats.countryList)}`),
        h('div', { class: 'stat-grid' },
            statTile(stats.visitedCountries, 'countries', 'tone-visited'),
            statTile(stats.visitedContinents, 'continents'),
            statTile(stats.visitedCities, 'cities'),
            stats.livedCountries ? statTile(stats.livedCountries, 'lived in', 'tone-lived') : null,
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
    const home = index.byId.get(stats.homeId);

    fill(container,
        h('section', { class: 'passport-cover' },
            h('p', { class: 'eyebrow' }, 'Passport of'),
            h('h2', {}, user.username),
            h('p', { class: 'rank' }, `🏆 ${stats.rank.title}`),
            home ? h('p', { class: 'passport-home' }, `${HOME.icon} Home: ${home.flag} ${home.name}`) : null,
            next ? h('div', { class: 'rank-progress' },
                h('span', { class: 'progress' }, h('span', { style: `width:${progress}%` })),
                h('small', {}, `${next.min - stats.visitedCountries} more ${next.min - stats.visitedCountries === 1 ? 'country' : 'countries'} to ${next.title}`)
            ) : h('small', {}, 'You have reached the top rank!')
        ),
        h('div', { class: 'stat-grid' },
            statTile(stats.visitedCountries, 'countries', 'tone-visited'),
            statTile(`${stats.worldPercent}%`, shareLabel(stats.countryList)),
            statTile(`${stats.visitedContinents}/6`, 'continents'),
            statTile(stats.visitedCities, 'cities'),
            // Lived in and transit only are counted on their own, when there are any.
            stats.livedCountries ? statTile(stats.livedCountries, 'lived in', 'tone-lived') : null,
            stats.transitCountries ? statTile(stats.transitCountries, 'transit only', 'tone-transit') : null,
            statTile(stats.wishlistCountries, 'dream countries', 'tone-wishlist'),
            statTile(ctx.state.trips.length, 'trips planned')
        ),
        h('section', {}, h('h3', { class: 'section-title' }, 'Continents'), continentBars(stats)),
        h('section', {},
            h('h3', { class: 'section-title' }, 'Stamps', h('span', { class: 'count' }, stats.visitedCountries)),
            stamps(stats, index, country => {
                ctx.map.flyToCountry(country);
            }),
            uncountedNote(stats, index),
            transitNote(stats, index),
            h('p', { class: 'muted small' }, `Counting ${countryList(stats.countryList).phrase} `
                + `(${stats.totalCountries}). Change it in ⚙️ Settings.`)
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
