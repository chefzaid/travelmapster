// Keyboard shortcuts across the app: `/` to search, `T` for the timeline, `D` for days on the
// map, `[` to fold the side panel, and `?` to list them. They wait while the traveler types or
// a dialog is open.
import { h, $ } from './ui.js';
import { t, tk } from './i18n.js';

export const SHORTCUTS = [
    ['/', tk('Search a country or city')],
    ['T', tk('Open or close the timeline')],
    ['D', tk('Color the map by days spent, or by status')],
    ['[', tk('Fold the side panel away, or open it')],
    ['Esc', tk('Close a card, a dialog, the timeline or the menu')],
    ['?', tk('Show these shortcuts')]
];

/** Whether the keys go to a field the traveler is typing in. */
export function isTyping(element = document.activeElement) {
    return /INPUT|TEXTAREA|SELECT/.test(element?.tagName) || Boolean(/** @type {HTMLElement} */ (element)?.isContentEditable);
}

// Presses a control of the page when it is shown, as a click would.
function press(selector) {
    const control = /** @type {HTMLElement | null} */ ($(selector));
    if (control && !control.hidden && control.offsetParent) control.click();
}

function showShortcuts() {
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'shortcuts-title' },
        h('form', { method: 'dialog', class: 'dialog-body' },
            h('h3', { id: 'shortcuts-title' }, t('Keyboard shortcuts')),
            h('dl', { class: 'shortcuts' }, SHORTCUTS.flatMap(([key, label]) => [h('dt', {}, h('kbd', {}, key)), h('dd', {}, t(label))])),
            h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', value: 'close' }, t('Close')))
        ));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
}

const ACTIONS = {
    '/': () => $('#global-search').focus(),
    t: () => press('#timeline-btn'),
    d: () => press('#legend-days'),
    '[': () => press('#panel-fold'),
    '?': showShortcuts
};

export function setupShortcuts() {
    document.addEventListener('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey || isTyping() || document.querySelector('dialog[open]')) return;
        const action = ACTIONS[event.key.length === 1 ? event.key.toLowerCase() : ''];
        if (!action) return;
        event.preventDefault();
        action();
    });
}
