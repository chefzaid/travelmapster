// Ledger tab, evidence side: the date history and the day-by-day evidence report, printed
// or downloaded as CSV. Built on the device from days.js, only when asked.
import { h, downloadFile, formatDate } from './ui.js';
import { openPrintView, printTable } from './print-view.js';
import { DAY_RULES, localToday } from './days.js';
import { buildEvidenceCsv, describeChange, evidenceReport } from './ledger-evidence.js';
import { locale, t, tn } from './i18n.js';

const form = { country: 'all', from: '', to: '' };

export const adviceNote = () => t('A guide, not legal or tax advice: border officers and tax authorities make the final decision, so check anything that matters with an adviser.');

export function countryName(ctx, id) {
    return ctx.state.index.byId.get(id)?.name || id;
}

function changeWhen(change) {
    return new Date(change.changedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function historySection(ctx) {
    const { changes } = ctx.state.ledger;
    let body;
    if (!changes) body = h('p', { class: 'muted small' }, t('Loading the date history…'));
    else if (!changes.length) body = h('p', { class: 'muted small' }, t('No changes to visit dates yet.'));
    else {
        body = h('ol', { class: 'history' }, changes.slice(0, 8).map(change => h('li', {},
            h('small', {}, changeWhen(change)),
            h('span', {}, h('strong', {}, change.placeName), `: ${describeChange(change, formatDate)}`)
        )));
    }
    return h('section', { 'aria-labelledby': 'history-title' },
        h('h3', { class: 'section-title', id: 'history-title' }, t('Date history')),
        body,
        h('p', { class: 'muted small' }, t('Every visit date you add, change or remove is kept for evidence reports.'))
    );
}

function reportCountries(ctx, overview) {
    return [...overview.ledger.countries.keys()].sort((a, b) => countryName(ctx, a).localeCompare(countryName(ctx, b)));
}

function openReport(ctx, report, opener) {
    const nameOf = id => countryName(ctx, id);
    const csvName = `travelmapster-evidence-${report.from}-${report.to}.csv`;
    const rule = DAY_RULES[report.dayRule];
    openPrintView({
        eyebrow: t('TravelMapster day ledger'),
        title: t('Day-by-day evidence'),
        opener,
        actions: h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => downloadFile(csvName, buildEvidenceCsv(report, nameOf), 'text/csv') }, t('⬇️ CSV')),
        content: [
            h('dl', { class: 'report-facts' },
                h('dt', {}, t('Traveler')), h('dd', {}, ctx.state.user.username),
                h('dt', {}, t('Period')), h('dd', {}, `${formatDate(report.from)} – ${formatDate(report.to)}`),
                h('dt', {}, t('Counting rule')), h('dd', {}, `${rule.label}. ${rule.description}`),
                h('dt', {}, t('Generated')), h('dd', {}, new Date().toLocaleString(locale(), { dateStyle: 'long', timeStyle: 'short' }))
            ),
            h('h2', {}, t('Days per country')),
            printTable([t('Country'), t('Days')],
                report.totals.map(total => h('tr', {}, h('th', { scope: 'row' }, nameOf(total.countryId)), h('td', {}, total.days)))),
            h('h2', {}, t('Days')),
            report.rows.length ? printTable([t('Date'), t('Country'), t('Place'), t('Visit'), t('Why it counts')],
                report.rows.flatMap(row => row.sources.map(source => h('tr', {},
                    h('td', {}, row.date),
                    h('td', {}, nameOf(row.countryId)),
                    h('td', {}, source.place),
                    h('td', {}, source.endDate ? `${source.startDate} – ${source.endDate}` : `${source.startDate} – ${source.ongoing ? t('still there') : t('not recorded')}`),
                    h('td', {}, source.note, source.edited ? h('small', { class: 'report-edited' }, t('Dates edited: {changes}', { changes: source.history.join('; ') })) : null)
                ))))
                : h('p', {}, t('No days in this period.')),
            h('h2', {}, t('Changes to visit dates')),
            report.changes.length ? printTable([t('When'), t('Place'), t('Change')],
                report.changes.map(change => h('tr', {},
                    h('td', {}, changeWhen(change)), h('td', {}, change.placeName), h('td', {}, describeChange(change, formatDate))
                )))
                : h('p', {}, t('No changes recorded for these visits.')),
            h('p', { class: 'report-foot' }, t('Each day lists the visit it comes from. A city counts for its country. A visit without a last day counts its first day only, unless it is marked as still going on, when it counts up to the day of the report. The date history starts with the day ledger; visits recorded earlier show no history before it.')),
            h('p', { class: 'report-foot' }, adviceNote())
        ]
    });
}

export function reportSection(ctx, overview) {
    const today = localToday();
    const countries = reportCountries(ctx, overview);
    if (!form.from) form.from = `${today.slice(0, 4)}-01-01`;
    if (!form.to) form.to = today;
    const status = h('p', { class: 'muted small', role: 'status' });

    const build = async () => {
        if (!form.from || !form.to || form.to < form.from) {
            status.textContent = t('Choose a period that ends on or after it starts.');
            return null;
        }
        status.textContent = t('Preparing the report…');
        try {
            const changes = await ctx.loadVisitChanges();
            const countryIds = form.country === 'all' ? countries : [form.country];
            const report = evidenceReport(ctx.currentLedger().ledger, { countryIds, from: form.from, to: form.to, changes });
            status.textContent = tn(report.rows.length, '{count} day in the report.', '{count} days in the report.');
            return report;
        } catch (error) {
            status.textContent = '';
            ctx.handleError(error);
            return null;
        }
    };
    const input = (key, label, type) => h('label', { class: 'field', for: `report-${key}` }, h('span', {}, label),
        h('input', { id: `report-${key}`, type, value: form[key], oninput: event => { form[key] = event.target.value; } }));

    return h('section', { 'aria-labelledby': 'report-section-title' },
        h('h3', { class: 'section-title', id: 'report-section-title' }, t('Evidence report')),
        h('p', { class: 'muted small' }, t('Every counted day with the visit it comes from and any change to its dates. Made on your device when you ask; print it to PDF or download a CSV.')),
        h('label', { class: 'field', for: 'report-country' }, h('span', {}, t('Country')),
            h('select', { id: 'report-country', onchange: event => { form.country = event.target.value; } },
                h('option', { value: 'all', selected: form.country === 'all' }, t('All countries')),
                countries.map(id => h('option', { value: id, selected: form.country === id }, countryName(ctx, id))))),
        h('div', { class: 'row' }, input('from', 'From', 'date'), input('to', 'To', 'date')),
        h('div', { class: 'row' },
            h('button', {
                type: 'button',
                class: 'btn btn-sm btn-primary',
                onclick: async event => {
                    const opener = event.currentTarget;
                    const report = await build();
                    if (report) openReport(ctx, report, opener);
                }
            }, t('📄 View report')),
            h('button', {
                type: 'button',
                class: 'btn btn-sm btn-ghost',
                onclick: async () => {
                    const report = await build();
                    if (report) downloadFile(`travelmapster-evidence-${report.from}-${report.to}.csv`, buildEvidenceCsv(report, id => countryName(ctx, id)), 'text/csv');
                }
            }, t('⬇️ CSV'))
        ),
        status
    );
}
