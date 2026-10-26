// Map palettes (ADR 0016), printing the map as it is on screen, and map posters to download.
import { h, $, formDialog, downloadFile, toast } from './ui.js';
import { POSTER_SIZES, POSTER_STYLES, mapStatusOf, posterSvg } from './poster.js';
import { PALETTES, paletteId } from './palettes.js';
import { timelineView } from './timeline-bar.js';
import { t, tn } from './i18n.js';

const PALETTE_KEY = 'travelmapster.palette';

export function storedPalette() {
    try {
        return localStorage.getItem(PALETTE_KEY);
    } catch {
        return null;
    }
}

// Switches the map colors; the CSS tokens change, then the map redraws from them. The choice
// is remembered in this browser, so the next visit starts with it.
export function applyPalette(ctx, id) {
    const palette = paletteId(id);
    const root = document.documentElement;
    const changed = (root.dataset.palette || 'standard') !== palette;
    if (palette === 'standard') delete root.dataset.palette;
    else root.dataset.palette = palette;
    try {
        localStorage.setItem(PALETTE_KEY, palette);
    } catch {
        // Storage can be unavailable; the palette still applies to this page.
    }
    $('#public-palette').value = palette;
    if (changed) ctx.map?.refreshTheme();
}

function printTitle(ctx) {
    const owner = ctx.state.user?.username || ctx.state.publicUser;
    const title = owner ? t('{username}\'s travel map', { username: owner }) : t('A sample TravelMapster map');
    const view = timelineView(ctx);
    if (!view) return title;
    return `${title}, ${view.mode === 'during' ? 'places visited during' : 'by the end of'} ${view.year}`;
}

// Printing shows a picture of the map as it is on screen (see the print styles). The evidence
// report prints on its own.
function preparePrint(ctx) {
    const image = $('#map-print');
    if (document.body.classList.contains('is-reporting') || image.getAttribute('src')) return;
    $('#print-title').textContent = printTitle(ctx);
    image.src = ctx.map.snapshot();
}

async function printMap(ctx) {
    preparePrint(ctx);
    try {
        await $('#map-print').decode();
    } catch {
        // Print anyway: the browser waits for the picture or prints the page without it.
    }
    window.print();
}

/** Asks for a size, style and title, then downloads the traveler's map as a vector poster. */
async function makePoster(ctx) {
    const { stats, index, markers, user } = ctx.state;
    const values = await formDialog({
        title: t('Make a poster'),
        message: t('A vector file (SVG) of your map, sharp at any size: print it at home, or send it to any print shop.'),
        submitLabel: t('Download poster'),
        fields: [
            { name: 'title', label: t('Title'), value: t('{username}\'s travel map', { username: user.username }), required: true, maxlength: 80 },
            { name: 'size', label: t('Size'), type: 'select', value: 'a3', options: POSTER_SIZES.map(size => ({ value: size.id, label: size.label })) },
            { name: 'style', label: t('Style'), type: 'select', value: 'cartoon', options: Object.entries(POSTER_STYLES).map(([value, style]) => ({ value, label: style.label })) }
        ]
    });
    if (!values) return;
    const status = mapStatusOf(stats);
    const ids = index.countries.map(country => country.id);
    const counts = {};
    for (const id of ids) {
        const look = status(id);
        if (look) counts[look] = (counts[look] || 0) + 1;
    }
    const cities = markers.filter(marker => marker.category === 'City' && marker.type === 'visited').map(marker => [Number(marker.lng), Number(marker.lat)]);
    const svg = posterSvg({
        countries: index.countries.map(country => country.feature), statusOf: status, counts, cities,
        size: values.size, style: values.style, title: values.title.trim(),
        subtitle: `${tn(stats.visitedCountries, '{count} country', '{count} countries')} · ${new Date().getFullYear()}`
    });
    downloadFile(`travelmapster-poster-${values.size}.svg`, svg, 'image/svg+xml');
    toast(t('Poster downloaded.'), { tone: 'success' });
}

export function setupPrinting(ctx) {
    $('#poster-btn').addEventListener('click', () => {
        ctx.closeAccountMenu();
        makePoster(ctx);
    });
    window.addEventListener('beforeprint', () => preparePrint(ctx));
    window.addEventListener('afterprint', () => $('#map-print').removeAttribute('src'));
    $('#print-btn').addEventListener('click', () => {
        ctx.closeAccountMenu();
        printMap(ctx);
    });
    $('#public-print').addEventListener('click', () => printMap(ctx));
    const select = $('#public-palette');
    select.replaceChildren(...PALETTES.map(palette => h('option', { value: palette.id }, palette.label)));
    select.value = paletteId(document.documentElement.dataset.palette);
    select.addEventListener('change', () => applyPalette(ctx, select.value));
}
