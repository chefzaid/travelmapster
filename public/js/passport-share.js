// Picture cards from the passport, to share on social networks or in messages: the country
// count, the stamps and this year's recap, without notes, photos, places or dates. The cards
// are drawn in share-cards.js; this module turns them into PNG files.
import { h, toast, downloadFile } from './ui.js';
import { localToday } from './days.js';
import { shareLabel } from './lists.js';
import { goalCount } from './goals.js';
import { countriesByYear, daysAwayByYear, longestTrip } from './travel-stats.js';
import { CARD_SIZE, countryCountCard, stampsCard, svgDataUrl, yearRecapCard } from './share-cards.js';

// The PNG of a card: the SVG drawn on a canvas.
async function cardPng(svg) {
    const image = new Image();
    image.src = svgDataUrl(svg);
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = CARD_SIZE;
    canvas.height = CARD_SIZE;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The card could not be drawn.'))), 'image/png'));
}

// Shares the card where the device can (phones), and downloads it everywhere else.
async function shareCard(svg, fileName, title) {
    try {
        const png = await cardPng(svg);
        const file = new File([png], fileName, { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title });
                return;
            } catch (error) {
                if (error.name === 'AbortError') return;
            }
        }
        downloadFile(fileName, png, 'image/png');
        toast('Picture downloaded: share it anywhere.', { tone: 'success' });
    } catch (error) {
        toast(error.message || 'The picture could not be made.', { tone: 'error' });
    }
}

function stampsOf(stats, index) {
    return [...stats.visitedIds].filter(id => stats.countedIds.has(id)).map(id => index.byId.get(id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name)).map(country => ({ flag: country.flag, name: country.name }));
}

// This year's recap, from the visits begun in it.
function recap(ctx) {
    const { markers, stats, user } = ctx.state;
    const today = localToday();
    const year = today.slice(0, 4);
    const countryOf = marker => stats.markerCountry.get(marker.id);
    const thisYear = markers.map(marker => ({ ...marker, visits: (marker.visits || []).filter(visit => visit.startDate.startsWith(`${year}-`)) }));
    const row = countriesByYear(markers, { countryOf, countedIds: stats.countedIds }).find(item => item.year === year);
    const trip = longestTrip(thisYear, { countryOf, homeId: stats.homeId, today });
    return yearRecapCard({
        username: user.username,
        year,
        countries: row?.count || 0,
        newCountries: row?.newCount || 0,
        trips: goalCount({ year, kind: 'visits' }, markers, { countryOf, countedIds: stats.countedIds }),
        daysAway: daysAwayByYear(ctx.currentLedger().ledger, stats.homeId, today).find(item => item.year === year)?.count || 0,
        longestTrip: trip ? `${trip.days} ${trip.days === 1 ? 'day' : 'days'}, ${trip.route}` : '',
        awayWord: stats.homeId ? 'abroad' : 'recorded'
    });
}

export function shareCardsSection(ctx) {
    const { stats, index, user } = ctx.state;
    const date = localToday();
    /** @type {Array<[string, () => string, string]>} */
    const cards = [
        ['🌍 Countries', () => countryCountCard({
            username: user.username, countries: stats.visitedCountries, worldPercent: stats.worldPercent,
            shareLabel: shareLabel(stats.countryList), continents: stats.visitedContinents, rank: stats.rank.title
        }), 'countries'],
        ['🛂 Stamps', () => stampsCard({ username: user.username, stamps: stampsOf(stats, index) }), 'stamps'],
        [`🗓️ ${date.slice(0, 4)} recap`, () => recap(ctx), `recap-${date.slice(0, 4)}`]
    ];
    return h('section', { id: 'share-pictures', 'aria-labelledby': 'share-pictures-title' },
        h('h3', { class: 'section-title', id: 'share-pictures-title' }, 'Share a picture'),
        h('p', { class: 'muted small' }, 'Square pictures of your counts and stamps for social networks and messages. They never show notes, photos, places or dates.'),
        h('div', { class: 'row' }, cards.map(([label, build, name]) => h('button', {
            type: 'button',
            class: 'btn btn-sm btn-ghost',
            onclick: () => shareCard(build(), `travelmapster-${name}-${date}.png`, `${user.username} on TravelMapster`)
        }, label)))
    );
}
