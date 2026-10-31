// Places tab, "Possible duplicates": places saved twice (duplicates.js), each pair merged into one
// after the traveler confirms, keeping every visit.
import { h, toast } from './ui.js';
import { findDuplicates } from './duplicates.js';
import { visitCountLabel } from './visits.js';
import { statusOf } from './status.js';
import { t, tn } from './i18n.js';

async function merge(ctx, { keep, other }) {
    const confirmed = await ctx.confirmDialog({
        title: t('Merge {other} into {keep}?', { other: other.name, keep: keep.name }),
        message: tn(other.visits?.length || 0, '{keep} keeps its details and takes {count} visit and the details it lacks from {other}, which is then removed.', '{keep} keeps its details and takes {count} visits and the details it lacks from {other}, which is then removed.', { keep: keep.name, other: other.name }),
        confirmLabel: t('Merge')
    });
    if (!confirmed) return;
    try {
        const merged = await ctx.api.mergeMarkers(keep.id, other.id);
        ctx.state.markers = ctx.state.markers.filter(marker => marker.id !== other.id).map(marker => (marker.id === keep.id ? merged : marker));
        ctx.refresh();
        toast(t('Merged into {name}.', { name: merged.name }), { tone: 'success' });
    } catch (error) {
        ctx.handleError(error);
    }
}

const visitsOf = marker => visitCountLabel(marker.visits?.length || 0, statusOf(marker));

export function duplicatesSection(ctx) {
    const pairs = findDuplicates(ctx.state.markers);
    if (!pairs.length) return null;
    return h('section', { 'aria-labelledby': 'duplicates-title' },
        h('h3', { class: 'section-title', id: 'duplicates-title' }, t('🔁 Possible duplicates'), h('span', { class: 'count' }, pairs.length)),
        h('p', { class: 'muted small' }, t('The same place saved twice, often after an import. Merging keeps every visit.')),
        h('ul', { class: 'ledger-list', id: 'duplicates' }, pairs.map(pair => h('li', { class: 'ledger-item' },
            h('span', { class: 'ledger-item-text' },
                h('strong', {}, pair.keep.name === pair.other.name ? pair.keep.name : t('{keep} and {other}', { keep: pair.keep.name, other: pair.other.name })),
                h('small', {}, `${visitsOf(pair.keep)} · ${visitsOf(pair.other)}`)),
            h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => merge(ctx, pair) }, t('Merge'))))));
}
