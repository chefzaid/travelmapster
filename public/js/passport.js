// Passport tab: rank, counts, continents, stamps, badges and travel statistics; and the
// counts shown on a public map.
import { h, $, fill, formatDate, copyText } from './ui.js';
import { HOME } from './status.js';
import { countryList, shareLabel } from './lists.js';
import { localToday } from './days.js';
import { goalsSection } from './passport-goals.js';
import { shareCardsSection, stampedCountries } from './passport-share.js';
import { flagLine } from './share-cards.js';
import { countdownLabel, upcomingTrip } from './trip-countdown.js';
import { formatDistance } from './units.js';
import { worldShare } from './world-share.js';
import { friendsSection } from './friends.js';
import { EARTH_CIRCUMFERENCE_KM, countriesByYear, daysAwayByYear, distanceTraveled, longestTrip, yearStreak } from './travel-stats.js';
import { formatList, formatNumber, t, tn } from './i18n.js';
import { regionName } from './geo.js';

function statTile(value, label, tone = '') {
    return h('div', { class: `stat ${tone}` }, h('strong', {}, value), h('small', {}, label));
}

function continentBars(stats) {
    return h('ul', { class: 'continent-bars' }, stats.continents.map(continent => h('li', {},
        h('span', { class: 'bar-label' }, h('span', { 'aria-hidden': 'true' }, continent.emoji), ` ${regionName(continent.name)}`),
        h('span', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(continent.total), 'aria-valuenow': String(continent.visited), 'aria-label': t('{name}: {visited} of {total}', { name: continent.name, visited: continent.visited, total: continent.total }) },
            h('span', { style: `width:${Math.max(continent.percent, continent.visited ? 4 : 0)}%` })),
        h('small', { class: 'bar-count' }, `${continent.visited}/${continent.total}`)
    )));
}

// Collections to complete, with what is left when only a few remain.
function collectionsSection(stats, index) {
    return h('section', { id: 'collections' },
        h('h3', { class: 'section-title' }, t('Collections')),
        h('ul', { class: 'continent-bars' }, stats.collections.map(collection => {
            const percent = collection.total ? Math.round((collection.count / collection.total) * 100) : 0;
            return h('li', {},
                h('span', { class: 'bar-label' }, h('span', { 'aria-hidden': 'true' }, collection.icon), ` ${collection.title}`),
                h('span', {
                    class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(collection.total),
                    'aria-valuenow': String(collection.count), 'aria-label': t('{title}: {count} of {total}', { title: collection.title, count: collection.count, total: collection.total })
                }, h('span', { style: `width:${Math.max(percent, collection.count ? 4 : 0)}%` })),
                h('small', { class: 'bar-count' }, `${collection.count}/${collection.total}`)
            );
        })),
        stats.collections.map(collection => {
            if (!collection.count || !collection.missing.length || collection.missing.length > 5) return null;
            const names = collection.missing.map(id => index.byId.get(id)?.name || id).sort();
            return h('p', { class: 'muted small' }, t('{title}: {names} to go.', { title: collection.title, names: formatList(names) }));
        }),
        h('p', { class: 'muted small' }, t('Capitals count when you have been to a capital city; a country with several counts once.'))
    );
}

// Pseudo-random but stable tilt per country so stamps look hand-pressed.
function tilt(id) {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
    return (hash % 17) - 8;
}

// The home country and countries lived in carry a ribbon on their stamp (ADR 0014).
function stampRibbon(stats, id) {
    if (id === stats.homeId) return `${HOME.icon} ${t('Home')}`;
    return stats.livedIds.has(id) ? t('🔑 Lived') : '';
}

function stamps(stats, index, onPick) {
    const visited = stampedCountries(stats, index);
    if (!visited.length) {
        return h('p', { class: 'muted small' }, t('Your passport is empty. Every country you visit earns a stamp.'));
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

// The share of the world's land and people in the countries been to.
function worldShareTiles(stats, index) {
    if (!stats.visitedIds.size) return [];
    const share = worldShare(index.countries, stats.visitedIds);
    const percent = value => formatNumber(value, { style: 'percent', maximumFractionDigits: 1 });
    return [statTile(percent(share.land), t('of the world\'s land')), statTile(percent(share.people), t('of the world\'s people'))];
}

// Days to the next trip, or that it is under way.
function nextTripTile(ctx) {
    const next = upcomingTrip(ctx);
    if (!next) return null;
    return statTile(next.days ? `✈️ ${formatNumber(next.days)}` : '✈️', countdownLabel(next));
}

// The stamps as a line of flags, for a social bio or a message.
function copyFlagsButton(stats, index) {
    const countries = stampedCountries(stats, index);
    if (!countries.length) return null;
    return h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm copy-flags',
        onclick: () => {
            const line = flagLine(countries);
            copyText(line, t('Flags copied: {line}', { line }), t('Your flags: {line}', { line }));
        }
    }, t('📋 Copy my flags'));
}

// Territories been to that the chosen list leaves out are named, not stamped.
function uncountedNote(stats, index) {
    const names = stats.uncountedIds.map(id => index.byId.get(id)?.name).filter(Boolean).sort();
    if (!names.length) return null;
    return h('p', { class: 'muted small' }, h('span', { 'aria-hidden': 'true' }, '🗺️ '),
        t('Also been to, not on the {list} list: {names}.', { list: countryList(stats.countryList).unit, names: formatList(names) }));
}

// Layovers are listed but never stamped: they are not visits.
function transitNote(stats, index) {
    const names = [...stats.transitIds].map(id => index.byId.get(id)?.name).filter(Boolean).sort();
    if (!names.length) return null;
    return h('p', { class: 'muted small' }, h('span', { 'aria-hidden': 'true' }, '🛫 '),
        t('Transit only, not counted: {names}.', { names: formatList(names) }));
}


// A bar per year ({ year, count }), described in full by its title.
function yearChart(title, rows, describe) {
    if (!rows.length) return null;
    const max = Math.max(...rows.map(row => row.count));
    return h('section', {},
        h('h3', { class: 'section-title' }, title),
        h('ul', { class: 'year-chart' }, rows.map(row => h('li', { title: describe(row) },
            h('span', { class: 'year-bar', style: `height:${Math.max(8, Math.round((row.count / max) * 100))}%` }, h('span', {}, row.count)),
            h('small', {}, `’${row.year.slice(2)}`)
        )))
    );
}

// Days away from home, the longest trip, the distance between places and countries per year,
// all from dated visits; days count by the ledger's day rule.
// The best streaks, once they span two years or more.
function streakNote(newStreak, awayStreak) {
    const longer = streak => (streak?.best.length > 1 ? { count: streak.best.length, from: streak.best.from, to: streak.best.to } : null);
    const fresh = longer(newStreak);
    const abroad = longer(awayStreak);
    const parts = [
        fresh && tn(fresh.count, '{count} year with a new country ({from}–{to})', '{count} years with a new country ({from}–{to})', fresh),
        abroad && tn(abroad.count, '{count} year abroad ({from}–{to})', '{count} years abroad ({from}–{to})', abroad)
    ].filter(Boolean);
    return parts.length ? h('p', { class: 'muted small' }, t('Best streaks: {streaks}.', { streaks: formatList(parts) })) : null;
}

function travelSections(ctx) {
    const { markers, stats } = ctx.state;
    const countryOf = marker => stats.markerCountry.get(marker.id);
    const today = localToday();
    const home = Boolean(stats.homeId);
    const trip = longestTrip(markers, { countryOf, homeId: stats.homeId, today });
    const km = distanceTraveled(markers, { countryOf, today });
    const away = daysAwayByYear(ctx.currentLedger().ledger, stats.homeId, today);
    const perYear = countriesByYear(markers, { countryOf, countedIds: stats.countedIds });
    const awayDays = count => (home ? tn(count, '{count} day abroad', '{count} days abroad') : tn(count, '{count} day recorded', '{count} days recorded'));
    // Streaks: years in a row with a new country, and with days abroad once home is known.
    const thisYear = Number(today.slice(0, 4));
    const newStreak = yearStreak(perYear.filter(row => row.newCount).map(row => row.year), thisYear);
    const awayStreak = home ? yearStreak(away.filter(row => row.count).map(row => row.year), thisYear) : null;
    if (!trip && !away.length) {
        return h('section', {}, h('h3', { class: 'section-title' }, t('On the road')),
            h('p', { class: 'muted small' }, t('Add dates to your visits to see your days abroad, your longest trip and how far you have traveled.')));
    }
    return [
        h('section', { id: 'travel-stats' },
            h('h3', { class: 'section-title' }, t('On the road')),
            h('div', { class: 'stat-grid' },
                statTile(away.find(row => row.year === today.slice(0, 4))?.count || 0, home ? t('days abroad this year') : t('days recorded this year')),
                trip ? statTile(trip.days, tn(trip.days, 'day, longest trip', 'days, longest trip')) : null,
                statTile(`≈ ${formatDistance(km)}`, t('between your places')),
                newStreak.best.length ? statTile(`🔥 ${formatNumber(newStreak.current)}`, tn(newStreak.current, 'year in a row with a new country', 'years in a row with a new country')) : null,
                awayStreak?.best.length ? statTile(`🧳 ${formatNumber(awayStreak.current)}`, tn(awayStreak.current, 'year in a row abroad', 'years in a row abroad')) : null
            ),
            streakNote(newStreak, awayStreak),
            trip ? h('p', { class: 'muted small' }, t('Longest trip: {route}, {startDate} – {endDate}.', { route: trip.route, startDate: formatDate(trip.startDate), endDate: formatDate(trip.endDate) })) : null,
            h('p', { class: 'muted small' }, km
                ? t('About {times} times around the Earth, in straight lines between your places in the order you visited them.', { times: formatNumber(km / EARTH_CIRCUMFERENCE_KM, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })
                : t('Visit a second place to start counting the distance between them.'),
            home ? '' : ` ${t('Set a home country in ⚙️ Settings to count days abroad.')}`)
        ),
        yearChart(home ? t('Days abroad by year') : t('Days recorded by year'), away, row => `${row.year}: ${awayDays(row.count)}`),
        yearChart(t('Countries by year'), perYear, row => `${row.year}: ${tn(row.count, '{count} country', '{count} countries')}, ${tn(row.newCount, '{count} new', '{count} new')}`)
    ];
}

export function renderPublicStats(container, stats) {
    fill(container,
        h('p', { class: 'muted' }, `${stats.rank.title} · ${stats.worldPercent}% ${shareLabel(stats.countryList)}`),
        h('div', { class: 'stat-grid' },
            statTile(stats.visitedCountries, tn(stats.visitedCountries, 'country', 'countries'), 'tone-visited'),
            statTile(stats.visitedContinents, tn(stats.visitedContinents, 'continent', 'continents')),
            statTile(stats.visitedCities, tn(stats.visitedCities, 'city', 'cities')),
            stats.livedCountries ? statTile(stats.livedCountries, t('lived in'), 'tone-lived') : null,
            statTile(stats.wishlistCountries, t('on wishlist'), 'tone-wishlist')
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
            h('p', { class: 'eyebrow' }, t('Passport of')),
            h('h2', {}, user.username),
            h('p', { class: 'rank' }, `🏆 ${stats.rank.title}`),
            home ? h('p', { class: 'passport-home' }, t('{icon} Home: {flag} {name}', { icon: HOME.icon, flag: home.flag, name: home.name })) : null,
            next ? h('div', { class: 'rank-progress' },
                h('span', { class: 'progress' }, h('span', { style: `width:${progress}%` })),
                h('small', {}, tn(next.min - stats.visitedCountries, '{count} more country to {title}', '{count} more countries to {title}', { title: next.title }))
            ) : h('small', {}, t('You have reached the top rank!'))
        ),
        h('div', { class: 'stat-grid' },
            statTile(stats.visitedCountries, tn(stats.visitedCountries, 'country', 'countries'), 'tone-visited'),
            statTile(`${stats.worldPercent}%`, shareLabel(stats.countryList)),
            ...worldShareTiles(stats, index),
            statTile(`${stats.visitedContinents}/6`, t('continents')),
            statTile(stats.visitedCities, tn(stats.visitedCities, 'city', 'cities')),
            // Lived in and transit only are counted on their own, when there are any.
            stats.livedCountries ? statTile(stats.livedCountries, t('lived in'), 'tone-lived') : null,
            stats.transitCountries ? statTile(stats.transitCountries, t('transit only'), 'tone-transit') : null,
            statTile(stats.wishlistCountries, tn(stats.wishlistCountries, 'dream country', 'dream countries'), 'tone-wishlist'),
            statTile(ctx.state.trips.length, tn(ctx.state.trips.length, 'trip planned', 'trips planned')),
            nextTripTile(ctx)
        ),
        goalsSection(ctx),
        h('section', {}, h('h3', { class: 'section-title' }, t('Continents')), continentBars(stats)),
        collectionsSection(stats, index),
        h('section', {},
            h('h3', { class: 'section-title' }, t('Stamps'), h('span', { class: 'count' }, stats.visitedCountries)),
            stamps(stats, index, country => {
                ctx.map.flyToCountry(country);
            }),
            copyFlagsButton(stats, index),
            uncountedNote(stats, index),
            transitNote(stats, index),
            h('p', { class: 'muted small' }, t('Counting {list} ({total}). Change it in ⚙️ Settings.', { list: countryList(stats.countryList).phrase, total: stats.totalCountries }))
        ),
        h('section', {},
            h('h3', { class: 'section-title' }, t('Badges'), h('span', { class: 'count' }, `${unlocked}/${stats.achievements.length}`)),
            h('ul', { class: 'badges' }, stats.achievements.map(badge => h('li', {
                class: `badge${badge.unlocked ? ' is-unlocked' : ''}`,
                title: `${badge.title}: ${badge.description}`
            },
                h('span', { class: 'badge-icon', 'aria-hidden': 'true' }, badge.unlocked ? badge.icon : '🔒'),
                h('strong', {}, badge.title),
                h('small', {}, badge.description),
                h('span', { class: 'visually-hidden' }, badge.unlocked ? t('Unlocked') : t('Locked'))
            )))
        ),
        yearChart(t('Visits by year'), stats.years, row => `${row.year}: ${tn(row.count, '{count} visit', '{count} visits')}`),
        travelSections(ctx),
        friendsSection(ctx),
        // A guest map is never public (ADR 0026).
        user.guest ? null : h('section', { class: 'share-card' },
            h('h3', {}, t('🔗 Share your map')),
            h('p', { class: 'muted small' }, isPublic
                ? t('Your map is public. Anyone with the link can see your countries and cities (notes and photos stay private).')
                : t('Make your map public to share a read-only link with friends. Notes and photos stay private.')),
            h('button', {
                type: 'button',
                class: 'btn btn-sm btn-primary',
                onclick: () => {
                    if (isPublic) $('#copy-share-btn').click();
                    else $('#public-toggle').click();
                }
            }, isPublic ? t('Copy share link') : t('Make my map public'))
        ),
        shareCardsSection(ctx)
    );
}
