// Map palettes (ADR 0016) and printing the map as it is on screen.
import { h, $ } from './ui.js';
import { PALETTES, paletteId } from './palettes.js';
import { timelineView } from './timeline-bar.js';

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
    const title = owner ? `${owner}'s travel map` : 'A sample TravelMapster map';
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

export function setupPrinting(ctx) {
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
