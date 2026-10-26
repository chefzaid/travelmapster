// The side panel (a bottom sheet on phones) and the map legend, whose statuses filter the map.
import { $, $all } from './ui.js';

export function setupPanel() {
    const handle = $('#panel-handle');
    handle.addEventListener('click', () => {
        const collapsed = $('#panel').classList.toggle('is-collapsed');
        handle.setAttribute('aria-expanded', String(!collapsed));
    });
}

export function setupLegend(ctx) {
    const { filters } = ctx.state;
    $('#legend-detail-filter').addEventListener('click', () => ctx.setDetailFilter({ tag: 'all', rating: 'all' }));
    for (const button of $all('.legend-item[data-filter]')) {
        button.addEventListener('click', () => {
            const key = button.dataset.filter;
            filters[key] = !filters[key];
            button.setAttribute('aria-pressed', String(filters[key]));
            ctx.refresh({ celebrateNew: false });
        });
    }
}
