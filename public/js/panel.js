// The side panel (a bottom sheet on phones) and the map legend, whose statuses filter the map.
import { $, $all } from './ui.js';
import { t } from './i18n.js';

const FOLDED_KEY = 'travelmapster.panelFolded';

/**
 * Folds the panel away on wider screens so the whole map can be seen and clicked, or opens
 * it again; the choice is remembered in this browser. Phones have the bottom sheet instead.
 */
export function setPanelFolded(folded, { remember = true } = {}) {
    $('#app').classList.toggle('panel-folded', folded);
    const button = $('#panel-fold');
    button.setAttribute('aria-expanded', String(!folded));
    button.querySelector('.panel-fold-label').textContent = folded ? t('Show panel') : t('Hide panel');
    if (!remember) return;
    try {
        localStorage.setItem(FOLDED_KEY, folded ? '1' : '0');
    } catch {
        // Storage can be unavailable; the panel stays as it is for this page.
    }
}

/** Opens the panel when something in it is asked for: a tab, the sign-in form, the skip link. */
export function showPanel() {
    if ($('#app').classList.contains('panel-folded')) setPanelFolded(false);
}

export function setupPanel() {
    const handle = $('#panel-handle');
    handle.addEventListener('click', () => {
        const collapsed = $('#panel').classList.toggle('is-collapsed');
        handle.setAttribute('aria-expanded', String(!collapsed));
    });
    let folded = false;
    try {
        folded = localStorage.getItem(FOLDED_KEY) === '1';
    } catch {
        // Storage can be unavailable; the panel starts open.
    }
    setPanelFolded(folded, { remember: false });
    $('#panel-fold').addEventListener('click', () => setPanelFolded(!$('#app').classList.contains('panel-folded')));
    $('.skip-link').addEventListener('click', showPanel);
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
