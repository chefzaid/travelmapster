// Ledger tab, travel history for visa forms: the stays abroad of the last 5 or 10 years, as a
// page to print or save as PDF, and as CSV (travel-history.js counts them).
import { h, downloadFile, formatDate } from './ui.js';
import { openPrintView, printTable } from './print-view.js';
import { localToday } from './days.js';
import { HISTORY_YEARS, buildHistoryCsv, purposeLabel, travelHistory } from './travel-history.js';
import { adviceNote, countryName } from './ledger-report.js';
import { t, tn } from './i18n.js';

const form = { years: 10 };

function history(ctx, overview) {
    return travelHistory(overview.presence, { homeId: ctx.state.stats.homeId, years: form.years, today: localToday() });
}

function openHistory(ctx, stays, opener) {
    const csvName = `travelmapster-travel-history-${form.years}-years.csv`;
    const home = ctx.state.stats.homeId;
    openPrintView({
        eyebrow: t('TravelMapster day ledger'),
        title: t('Travel history'),
        opener,
        actions: h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => downloadFile(csvName, buildHistoryCsv(stays, id => countryName(ctx, id)), 'text/csv')
        }, t('⬇️ CSV')),
        content: [
            h('dl', { class: 'report-facts' },
                h('dt', {}, t('Traveler')), h('dd', {}, ctx.state.user.username),
                h('dt', {}, t('Period')), h('dd', {}, tn(form.years, 'The last year', 'The last {count} years')),
                h('dt', {}, t('Home country')), h('dd', {}, home ? countryName(ctx, home) : t('Not set: every country is listed'))),
            stays.length ? printTable([t('Country'), t('Entry'), t('Exit'), t('Days'), t('Purpose'), t('Places')],
                stays.map(stay => h('tr', {},
                    h('th', { scope: 'row' }, countryName(ctx, stay.countryId)),
                    h('td', {}, formatDate(stay.from)),
                    h('td', {}, stay.ongoing ? t('still there') : formatDate(stay.to)),
                    h('td', {}, stay.days),
                    h('td', {}, purposeLabel(stay.purpose)),
                    h('td', {}, stay.places.join(', ')))))
                : h('p', {}, t('No stays abroad in this period.')),
            h('p', { class: 'report-foot' }, t('Dates come from your visits: check them against your passport stamps before you copy them into a form.')),
            h('p', { class: 'report-foot' }, adviceNote())
        ]
    });
}

/** The section: how many years, and the history to view or download. */
export function travelHistorySection(ctx, overview) {
    const count = h('p', { class: 'muted small', role: 'status' });
    const update = () => {
        count.textContent = tn(history(ctx, overview).length, '{count} stay abroad in this period.', '{count} stays abroad in this period.');
    };
    update();
    return h('section', { 'aria-labelledby': 'history-title' },
        h('h3', { class: 'section-title', id: 'history-title' }, t('🛂 Travel history for visa forms')),
        h('p', { class: 'muted small' }, t('Every stay abroad with its entry and exit days and its purpose, as visa applications ask for it. Your home country is left out.')),
        h('label', { class: 'field', for: 'history-years' }, h('span', {}, t('Period')),
            h('select', {
                id: 'history-years',
                onchange: event => {
                    form.years = Number(event.target.value);
                    update();
                }
            }, HISTORY_YEARS.map(years => h('option', { value: years, selected: years === form.years }, tn(years, 'The last year', 'The last {count} years'))))),
        count,
        h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: event => openHistory(ctx, history(ctx, overview), event.currentTarget) }, t('📄 View history')),
            h('button', {
                type: 'button', class: 'btn btn-sm btn-ghost',
                onclick: () => downloadFile(`travelmapster-travel-history-${form.years}-years.csv`, buildHistoryCsv(history(ctx, overview), id => countryName(ctx, id)), 'text/csv')
            }, t('⬇️ CSV'))));
}
