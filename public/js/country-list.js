// The map as a list: every country with its status in a table that screen-reader and keyboard
// users can browse and mark, an equal alternative to clicking the map. Opened from the skip
// link at the top of the page and from the Places tab; visitors of a public map can browse it.
import { h, $ } from './ui.js';
import { countryLook } from './geo.js';
import { HOME, STATUSES, statusLabel, statusOf } from './status.js';
import { countryMarker, markCountry } from './cards.js';
import { t, tn } from './i18n.js';

/** A country's look on the map in words: its status, "cities only", home, or not yet. */
function lookLabel(look) {
    if (look === 'home') return `${HOME.icon} ${HOME.label}`;
    if (look === 'cityOnly') return t('✓ Cities only');
    return look ? statusLabel(look) : t('Not yet');
}

// The status of the country itself; its cities are marked on their own. Marking one changes
// only its row, so the focus stays where the traveler is.
function statusSelect(ctx, country, onMarked) {
    const marker = countryMarker(ctx, country);
    const marked = marker ? statusOf(marker) : '';
    return h('select', {
        'aria-label': t('Mark {country}', { country: country.name }),
        disabled: country.id === ctx.state.stats.homeId,
        onchange: async event => {
            await markCountry(ctx, country, event.target.value);
            onMarked();
        }
    },
    h('option', { value: '', selected: !marked }, t('Not marked')),
    STATUSES.map(status => h('option', { value: status.id, selected: marked === status.id }, statusLabel(status.id))));
}

function countryRow(ctx, country, editable) {
    const look = h('td', {}, lookLabel(countryLook(country.id, ctx.state.stats)));
    const showLook = () => { look.textContent = lookLabel(countryLook(country.id, ctx.state.stats)); };
    return h('tr', {},
        h('th', { scope: 'row' }, h('span', { 'aria-hidden': 'true' }, `${country.flag} `), country.name),
        look,
        editable ? h('td', {}, statusSelect(ctx, country, showLook)) : null);
}

export function openCountryList(ctx) {
    const { state } = ctx;
    const editable = Boolean(state.user || state.demo) && !state.publicUser;
    const countries = [...state.index.countries].sort((a, b) => a.name.localeCompare(b.name));
    const body = h('tbody');
    const summary = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    const filter = h('input', { type: 'search', 'aria-label': t('Filter the countries'), placeholder: t('Filter the countries…') });
    const draw = () => {
        const query = filter.value.trim().toLowerCase();
        const shown = countries.filter(country => !query || country.name.toLowerCase().includes(query));
        body.replaceChildren(...shown.map(country => countryRow(ctx, country, editable)));
        summary.textContent = tn(shown.length, '{count} country shown.', '{count} countries shown.');
    };
    filter.addEventListener('input', draw);
    draw();
    const dialog = h('dialog', { class: 'dialog dialog-wide', 'aria-labelledby': 'country-list-title' },
        h('form', { method: 'dialog', class: 'dialog-body' },
            h('h3', { id: 'country-list-title' }, t('Countries as a list')),
            h('p', { class: 'muted small' }, editable
                ? t('Every country and territory of the map with its status. Marking one here colors it in on the map.')
                : t('Every country and territory of the map with its status.')),
            filter,
            summary,
            h('div', { class: 'country-table' }, h('table', {},
                h('thead', {}, h('tr', {},
                    h('th', { scope: 'col' }, t('Country')),
                    h('th', { scope: 'col' }, t('On the map')),
                    editable ? h('th', { scope: 'col' }, t('Mark')) : null)),
                body)),
            h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', value: 'close' }, t('Close')))
        ));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    filter.focus();
}

export function setupCountryList(ctx) {
    $('#country-list-link').addEventListener('click', event => {
        event.preventDefault();
        openCountryList(ctx);
    });
}
