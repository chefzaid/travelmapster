// A full page printed on its own (see the print styles in css/ledger.css): the evidence report
// and printable itineraries. Escape or Close goes back to the button that opened it.
import { h, $ } from './ui.js';
import { t } from './i18n.js';

export function closePrintView(opener) {
    $('#report-view')?.remove();
    document.body.classList.remove('is-reporting');
    opener?.focus();
}

/** Opens the page with its print button, any other actions, a heading and the content. */
export function openPrintView({ eyebrow, title, actions = [], content, opener }) {
    const close = () => closePrintView(opener);
    const page = h('div', {
        id: 'report-view',
        class: 'report-view',
        role: 'region',
        'aria-labelledby': 'report-title',
        onkeydown: event => { if (event.key === 'Escape') close(); }
    },
        h('article', { class: 'report' },
            h('div', { class: 'report-actions' },
                h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => window.print() }, t('🖨️ Print or save as PDF')),
                actions,
                h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: close }, t('Close'))
            ),
            h('p', { class: 'eyebrow' }, eyebrow),
            h('h1', { id: 'report-title', tabindex: '-1' }, title),
            content
        )
    );
    closePrintView();
    document.body.append(page);
    document.body.classList.add('is-reporting');
    $('#report-title').focus();
}

/** A table with a header row, as the printed pages use. */
export function printTable(headings, rows) {
    return h('table', { class: 'report-table' },
        h('thead', {}, h('tr', {}, headings.map(label => h('th', { scope: 'col' }, label)))),
        h('tbody', {}, rows));
}
