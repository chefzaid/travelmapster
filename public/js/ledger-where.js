// Ledger tab, "Where was I?": for any day or period, the countries and towns of each day from
// the dated visits, grouped into runs of days, with the days no visit covers. Counted on the
// device from the any-part-of-a-day ledger, like everything else in the tab.
import { h, fill, formatDate } from './ui.js';
import { addDays, localToday } from './days.js';
import { whereabouts } from './ledger-evidence.js';
import { countryLabel } from './ledger-parts.js';
import { formatList, t, tn } from './i18n.js';

const MAX_RUNS_SHOWN = 60;
const form = { from: '', to: '' };

function runDates(run) {
    const dates = run.from === run.to ? formatDate(run.from) : `${formatDate(run.from)} – ${formatDate(run.to)}`;
    return `${dates} · ${tn(run.days, '{count} day', '{count} days')}`;
}

function runItem(ctx, run) {
    return h('li', { class: `ledger-item${run.stays.length ? '' : ' is-empty'}` }, h('span', { class: 'ledger-item-text' },
        h('strong', {}, runDates(run)),
        run.stays.length
            ? run.stays.map(stay => h('small', {}, countryLabel(ctx, stay.countryId),
                stay.planned ? ` · ${t('planned stay')}` : stay.places.length ? `: ${formatList(stay.places)}` : ''))
            : h('small', {}, t('No visit recorded'))));
}

function answer(ctx, overview) {
    if (!form.from || !form.to || form.to < form.from) {
        return h('p', { class: 'muted small' }, t('Choose a period that ends on or after it starts.'));
    }
    const runs = whereabouts(overview.presence, form.from, form.to);
    const shown = runs.slice(0, MAX_RUNS_SHOWN);
    return [
        h('ol', { class: 'ledger-list whereabouts' }, shown.map(run => runItem(ctx, run))),
        runs.length > shown.length
            ? h('p', { class: 'muted small' }, tn(runs.length - shown.length, '{count} more stretch: choose a shorter period to see it.', '{count} more stretches: choose a shorter period to see them.'))
            : null
    ];
}

/** The "Where was I?" section: a period, the last 30 days at first, and where each day was spent. */
export function whereSection(ctx, overview) {
    const today = localToday();
    if (!form.to) form.to = today;
    if (!form.from) form.from = addDays(today, -29);
    const result = h('div', { 'aria-live': 'polite' }, answer(ctx, overview));
    const input = (key, label) => h('label', { class: 'field', for: `where-${key}` }, h('span', {}, label),
        h('input', {
            id: `where-${key}`, type: 'date', value: form[key],
            onchange: event => {
                form[key] = event.target.value;
                fill(result, answer(ctx, overview));
            }
        }));
    return h('section', { 'aria-labelledby': 'where-title' },
        h('h3', { class: 'section-title', id: 'where-title' }, t('🔎 Where was I?')),
        h('p', { class: 'muted small' }, t('The countries and towns of each day, from your dated visits. Travel days show both countries.')),
        h('div', { class: 'row' }, input('from', t('From')), input('to', t('To'))),
        result);
}
