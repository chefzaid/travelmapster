// Marking several countries at once: picking them on the map or through search, then one
// transactional request, with an undo that is one request too. The plan is built in bulk.js.
import { $, $all, toast } from './ui.js';
import { applyBulkResult, bulkRequest, bulkSummary, planBulkMark, undoRequest } from './bulk.js';
import { collapsePanelOnPhones } from './timeline-bar.js';
import { t, tn } from './i18n.js';

async function bulkMark(ctx, countries, type) {
    const { state } = ctx;
    const { visitedIds, transitIds, homeId } = state.stats;
    const plan = planBulkMark({ countries, type, countryMarkerOf: ctx.countryMarker, visitedIds, transitIds, homeId });
    if (!plan.create.length && !plan.update.length) {
        toast(type === 'visited' ? t('Those countries are already colored in.') : t('Those countries are already on your wishlist or visited.'));
        return false;
    }
    try {
        const result = await ctx.api.bulkMarkers(bulkRequest(plan));
        state.markers = applyBulkResult(state.markers, result);
        ctx.refresh();
        toast(bulkSummary(plan, type), { tone: 'success', action: { label: t('Undo'), run: () => undoBulkMark(ctx, plan, result) } });
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}

async function undoBulkMark(ctx, plan, result) {
    try {
        ctx.state.markers = applyBulkResult(ctx.state.markers, await ctx.api.bulkMarkers(undoRequest(plan, result)));
        ctx.refresh({ celebrateNew: false });
        toast(t('Undone: those countries are back as they were.'));
    } catch (error) {
        ctx.handleError(error);
    }
}

export function markContinent(ctx, continent, type) {
    return bulkMark(ctx, ctx.state.index.countries.filter(country => country.continent === continent), type);
}

function updateSelection(ctx) {
    const count = ctx.state.selection.size;
    $('#select-count').textContent = count
        ? tn(count, '{count} country selected', '{count} countries selected')
        : t('Click countries on the map, or search for them, to select them.');
    for (const button of $all('#select-bar [data-bulk]')) button.disabled = !count;
    ctx.map.setSelection(ctx.state.selection);
}

export function startSelecting(ctx) {
    if (ctx.state.timeline.open) ctx.setTimelineOpen(false);
    ctx.state.selection = new Set();
    ctx.map.closePopup();
    $('#select-bar').hidden = false;
    // The map is free to click above the bar.
    collapsePanelOnPhones();
    updateSelection(ctx);
    $('#select-cancel').focus();
}

export function stopSelecting(ctx) {
    if (!ctx.state.selection) return;
    const hadFocus = $('#select-bar').contains(document.activeElement);
    ctx.state.selection = null;
    $('#select-bar').hidden = true;
    ctx.map.setSelection([]);
    // Keyboard users go back to where they started picking.
    if (hadFocus) ($('#bulk-pick') || $('#panel')).focus();
}

export function toggleSelected(ctx, country) {
    if (!country) return;
    const { selection } = ctx.state;
    if (selection.has(country.id)) selection.delete(country.id);
    else selection.add(country.id);
    updateSelection(ctx);
}

export function setupSelectBar(ctx) {
    for (const button of $all('#select-bar [data-bulk]')) {
        button.addEventListener('click', async () => {
            const countries = [...ctx.state.selection].map(id => ctx.state.index.byId.get(id));
            if (await bulkMark(ctx, countries, button.dataset.bulk)) stopSelecting(ctx);
        });
    }
    $('#select-cancel').addEventListener('click', () => stopSelecting(ctx));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && ctx.state.selection && !document.querySelector('dialog[open]')) stopSelecting(ctx);
    });
}
