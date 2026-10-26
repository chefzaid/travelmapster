// Image cards to share: the country count, the passport stamps and a year's recap, as square
// SVG (1080 × 1080) that the browser turns into a PNG. Only counts, country names and flags:
// never notes, photos, places or dates. Pure, unit tested in Node.
import { tn, t } from './i18n.js';

export const CARD_SIZE = 1080;

const COLORS = { sky: '#bfe6f5', paper: '#fffdf7', ink: '#1f3b57', teal: '#4fc3b8', sun: '#ffd166', coral: '#f7a072' };
// Pictures drawn from SVG cannot load web fonts: system fonts, with emoji fonts for flags only
// (they also hold digits and spaces, which would spread the text).
const FONT = "'Trebuchet MS', 'Segoe UI', Helvetica, Arial, sans-serif";
const EMOJI_FONT = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, character =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);


function text(x, y, size, content, { weight = 600, fill = COLORS.ink, anchor = 'middle', font = '' } = {}) {
    const family = font ? ` font-family="${font}"` : '';
    return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${family}>${escapeXml(content)}</text>`;
}

// Long lines are cut to fit the card.
const fit = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function frame(body, footer) {
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_SIZE}" height="${CARD_SIZE}" viewBox="0 0 ${CARD_SIZE} ${CARD_SIZE}" font-family="${FONT}">`,
        `<rect width="${CARD_SIZE}" height="${CARD_SIZE}" fill="${COLORS.sky}"/>`,
        `<rect x="60" y="60" width="960" height="960" rx="56" fill="${COLORS.paper}" stroke="${COLORS.ink}" stroke-width="8"/>`,
        body,
        text(540, 970, 34, footer, { weight: 500 }),
        '</svg>'
    ].join('');
}

function bar(x, y, width, share, fill) {
    return `<rect x="${x}" y="${y}" width="${width}" height="36" rx="18" fill="#e8f2f6" stroke="${COLORS.ink}" stroke-width="4"/>`
        + `<rect x="${x}" y="${y}" width="${Math.max(36, Math.round(width * Math.min(share, 1)))}" height="36" rx="18" fill="${fill}" stroke="${COLORS.ink}" stroke-width="4"/>`;
}

/** The number of countries, the share of the world and the continents. */
export function countryCountCard({ username, countries, worldPercent, shareLabel, continents, rank }) {
    return frame([
        text(540, 200, 46, t('{username}\'s travel map', { username }), { weight: 500 }),
        text(540, 430, 230, countries),
        text(540, 520, 64, tn(countries, 'country', 'countries')),
        bar(190, 600, 700, worldPercent / 100, COLORS.teal),
        text(540, 720, 44, `${worldPercent}% ${shareLabel}`, { weight: 500 }),
        text(540, 800, 44, `${tn(continents, '{count} continent', '{count} continents')} · ${rank}`, { weight: 500 })
    ].join(''), 'TravelMapster');
}

/** Up to 48 stamps: a flag and a name for each country been to. */
export function stampsCard({ username, stamps }) {
    const shown = stamps.slice(0, 48);
    // Few stamps are drawn big; many fill a finer grid.
    const columns = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(shown.length))));
    const rows = Math.max(1, Math.ceil(shown.length / columns));
    // The grid fits between the heading and the footer, centred.
    const cell = Math.min(840 / columns, 600 / (rows * 0.95));
    const left = 540 - (columns * cell) / 2;
    const items = shown.map((stamp, i) => {
        const x = left + (i % columns) * cell + cell / 2;
        const y = 280 + Math.floor(i / columns) * cell * 0.95 + cell * 0.4;
        return text(x, y, Math.round(cell * 0.42), stamp.flag, { weight: 400, font: EMOJI_FONT })
            + text(x, y + Math.round(cell * 0.27), Math.round(cell * 0.12), fit(stamp.name, 14), { weight: 500 });
    });
    const more = stamps.length > shown.length ? text(540, 900, 36, tn(stamps.length - shown.length, 'and {count} more', 'and {count} more'), { weight: 500 }) : '';
    return frame([
        text(540, 170, 58, t('Passport stamps')),
        text(540, 225, 38, `${username} · ${tn(stamps.length, '{count} country', '{count} countries')}`, { weight: 500 }),
        ...items,
        more
    ].join(''), 'TravelMapster');
}

/** A year in travel: countries, new ones, trips, days away and the longest trip. */
export function yearRecapCard({ username, year, countries, newCountries, trips, daysAway, longestTrip, awayWord }) {
    const rows = [
        [tn(countries, '{count} country', '{count} countries'), newCountries ? tn(newCountries, '{count} new', '{count} new') : t('no new ones'), COLORS.teal],
        [tn(trips, '{count} trip', '{count} trips'), t('begun this year'), COLORS.sun],
        [tn(daysAway, '{count} day', '{count} days'), awayWord, COLORS.coral]
    ];
    const lines = rows.map(([big, small, fill], i) => {
        const y = 360 + i * 150;
        return `<circle cx="210" cy="${y - 22}" r="38" fill="${fill}" stroke="${COLORS.ink}" stroke-width="5"/>`
            + text(280, y, 70, big, { anchor: 'start' }) + text(280, y + 48, 34, small, { weight: 500, anchor: 'start' });
    });
    return frame([
        text(540, 170, 58, t('{year} in travel', { year })),
        text(540, 225, 38, username, { weight: 500 }),
        ...lines,
        longestTrip ? text(540, 860, 34, fit(t('Longest trip: {trip}', { trip: longestTrip }), 46), { weight: 500 }) : ''
    ].join(''), 'TravelMapster');
}

/** The card as a data: URL, which the page's Content Security Policy lets it draw. */
export function svgDataUrl(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
