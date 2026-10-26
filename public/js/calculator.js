// The public Schengen 90/180 calculator page: a form of stays and the result, drawn from
// schengen.js. Everything stays in this tab: no API calls, no storage.
import { h, $, fill, formatDate } from './ui.js';
import { localToday } from './days.js';
import { MAX_STAYS, checkStays, schengenCalculator } from './schengen.js';
import { loadLocale, preferredLocale, translateDom, t, tn, setupLanguagePickers } from './i18n.js';

const view = { rows: [], nextId: 1, checkDate: '' };

const dayCount = count => tn(count, '{count} day', '{count} days');
const spanLabel = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);

function addRow(values = {}) {
    view.rows.push({ id: view.nextId++, entry: values.entry || '', exit: values.exit || '' });
}

// ---------------------------------------------------------------- stay rows

function stayRow(row, position) {
    const label = t('Stay {number}', { number: position + 1 });
    const input = (field, text, hint) => h('label', { class: 'field', for: `stay-${row.id}-${field}` },
        h('span', {}, text),
        h('input', {
            id: `stay-${row.id}-${field}`,
            type: 'date',
            value: row[field],
            'aria-describedby': `stay-${row.id}-error`,
            oninput: event => {
                row[field] = event.target.value;
                update();
            }
        }),
        hint ? h('small', {}, hint) : null
    );
    return h('li', { class: 'stay-row', dataset: { id: row.id } },
        h('fieldset', {},
            h('legend', {}, label),
            h('div', { class: 'stay-fields' },
                input('entry', t('Entry day')),
                input('exit', t('Exit day'), t('Empty if still there')),
                h('button', {
                    type: 'button',
                    class: 'icon-btn stay-remove',
                    'aria-label': t('Remove stay {number}', { number: position + 1 }),
                    title: t('Remove stay'),
                    onclick: () => removeRow(row)
                }, '🗑️')
            ),
            h('p', { class: 'field-error', id: `stay-${row.id}-error`, hidden: true })
        )
    );
}

function renderRows() {
    fill($('#stay-list'), view.rows.map(stayRow));
    $('#add-stay').disabled = view.rows.length >= MAX_STAYS;
}

function removeRow(row) {
    const position = view.rows.indexOf(row);
    view.rows.splice(position, 1);
    if (!view.rows.length) addRow();
    renderRows();
    update();
    // Keep keyboard focus nearby once the row is gone.
    const next = view.rows[Math.min(position, view.rows.length - 1)];
    $(`#stay-${next.id}-entry`).focus();
}

// ---------------------------------------------------------------- result

function latestText(result) {
    const { check, latest } = result;
    const date = formatDate(check.date);
    if (!latest.days) {
        return latest.continuing
            ? t('Staying on to {date} goes over the limit: the 180 days up to then already hold 90 days in the area.', { date })
            : t('You can\'t enter on {date}: the 180 days up to then already hold 90 days in the area.', { date });
    }
    const until = formatDate(latest.lastDate);
    if (latest.continuing) return t('Staying on from {date}, the latest day you can stay is {until}.', { date, until });
    return t('Entering on {date}, you could stay {days}, until {until}.', { date, days: dayCount(latest.days), until });
}

function stayStatus(stay) {
    if (stay.overDays) return h('span', { class: 'chip chip-over' }, t('⛔ {days} over', { days: dayCount(stay.overDays) }));
    if (stay.planned) return h('span', { class: 'chip chip-warn' }, t('🗓️ Planned, fits'));
    return h('span', { class: 'chip chip-ok' }, t('✓ Within the limit'));
}

function stayDates(stay, today) {
    if (stay.endDate) return spanLabel(stay.startDate, stay.endDate);
    return t('{dates} (still there)', { dates: spanLabel(stay.startDate, today) });
}

function renderResult(result, errors, today) {
    const container = $('#calculator-result');
    const announcer = $('#result-announcer');
    if (!result.stays.length) {
        fill(container, h('p', { class: 'muted' }, errors.length ? t('Fix the dates above to see your days.') : t('Add a stay to see your days.')));
        announcer.textContent = '';
        return;
    }
    const { check, overstays } = result;
    const percent = Math.min(100, Math.round((check.used / result.maxDays) * 100));
    fill(container,
        h('div', { class: 'schengen-head' },
            h('div', {},
                h('p', { class: 'eyebrow' }, check.date === today ? t('Today') : t('On {date}', { date: formatDate(check.date) })),
                h('h3', { id: 'result-title' }, t('{used} of {maxDays} days used', { used: check.used, maxDays: result.maxDays }))
            ),
            h('p', { class: 'days-left' }, h('strong', { id: 'days-left' }, check.remaining), h('small', {}, t('days left')))
        ),
        h('span', {
            class: `meter${check.used >= result.maxDays ? ' is-full' : percent >= 80 ? ' is-high' : ''}`,
            role: 'progressbar',
            'aria-valuemin': '0',
            'aria-valuemax': String(result.maxDays),
            'aria-valuenow': String(Math.min(check.used, result.maxDays)),
            'aria-label': t('Schengen days used: {used} of {maxDays}', { used: check.used, maxDays: result.maxDays })
        }, h('span', { style: `width:${percent}%` })),
        h('p', { class: 'small' },
            t('{used} in the area from {windowStart} to {date}.', { used: dayCount(check.used), windowStart: formatDate(check.windowStart), date: formatDate(check.date) }),
            check.inside ? ` ${t('You are in the area that day.')}` : ''),
        h('p', { class: 'entry-result', id: 'latest-day' }, latestText(result)),
        overstays.length
            ? h('div', { class: 'overstay', role: 'alert' },
                h('h3', {}, h('span', { 'aria-hidden': 'true' }, '⛔ '), t('Over the 90-day limit')),
                h('ul', {}, overstays.map(run => h('li', {}, t('{from}: {days} over.', { from: spanLabel(run.from, run.to), days: dayCount(run.days) })))),
                h('p', { class: 'small' }, t('On these days the 180 days up to them held more than 90 days in the area. Shorten or move the stays above until this goes away.')))
            : h('p', { class: 'fits' }, h('span', { 'aria-hidden': 'true' }, '✓ '), t('No overstay: every day keeps within 90 days in any 180.')),
        h('table', { class: 'counter-table stay-table' },
            h('caption', { class: 'visually-hidden' }, t('Your stays')),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('Stay')), h('th', { scope: 'col' }, t('Days')), h('th', { scope: 'col' }, t('Status')))),
            h('tbody', {}, result.stays.map(stay => h('tr', {},
                h('td', {}, h('strong', {}, t('Stay {number}', { number: stay.index + 1 })), h('br'), h('small', {}, stayDates(stay, today))),
                h('td', {}, stay.days),
                h('td', {}, stayStatus(stay))
            )))
        )
    );
    announcer.textContent = [t('{used} of {maxDays} days used, {remaining} left.', { used: check.used, maxDays: result.maxDays, remaining: check.remaining }),
        overstays.length ? t('Over the limit.') : ''].join(' ').trim();
}

function update() {
    const today = localToday();
    const { stays, errors } = checkStays(view.rows, today);
    view.rows.forEach((row, index) => {
        const error = errors.find(item => item.index === index);
        const box = $(`#stay-${row.id}-error`);
        box.textContent = error?.message || '';
        box.hidden = !error;
        for (const field of ['entry', 'exit']) {
            const input = $(`#stay-${row.id}-${field}`);
            if (error?.field === field) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
        }
    });
    const checkDate = /^\d{4}-\d{2}-\d{2}$/.test(view.checkDate) ? view.checkDate : today;
    renderResult(schengenCalculator(stays, { today, checkDate }), errors, today);
}

function init() {
    const checkInput = $('#check-date');
    checkInput.value = localToday();
    checkInput.addEventListener('input', () => {
        view.checkDate = checkInput.value;
        update();
    });
    $('#add-stay').addEventListener('click', () => {
        addRow();
        renderRows();
        update();
        $(`#stay-${view.rows.at(-1).id}-entry`).focus();
    });
    // Results follow every change; Enter must not reload the page and lose the dates.
    $('#calculator-form').addEventListener('submit', event => event.preventDefault());
    addRow();
    renderRows();
    update();
}

// The page's language first (ADR 0031).
loadLocale(preferredLocale()).catch(() => {}).then(() => {
    translateDom();
    setupLanguagePickers();
    init();
});
