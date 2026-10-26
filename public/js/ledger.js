// Ledger tab: days per country from dated visits, the Schengen 90/180 calculator, stay
// rules, tax-residency thresholds and planned stays; the evidence report and date history are
// in ledger-report.js. The counting lives in days.js; these modules only draw it.
import { h, fill, toast, formDialog, formatDate } from './ui.js';
import {
    DAY_RULES, SCHENGEN_RULE, SCHENGEN_MEMBERS, SCHENGEN_OPEN_BORDERS, TAX_RESIDENCY_RULE,
    addDays, countryCounters, dayNumber, daysIn, isoDay, localToday, maxStayFrom
} from './days.js';
import { checkPlannedStay, checkRule, newId, parseCountryList } from './ledger-rules.js';
import { adviceNote, countryName, historySection, reportSection } from './ledger-report.js';
import { isTripPlan } from './itinerary.js';
import { meter, statusChip, countryLabel } from './ledger-parts.js';
import { orgRulesSections } from './ledger-org.js';
import { t, tn } from './i18n.js';
import { whereSection } from './ledger-where.js';

const view = { entry: '', period: '', showAllStays: false };
const STAYS_SHOWN = 12;

const dayCount = count => tn(count, '{count} day', '{count} days');

function spanLabel(from, to) {
    return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

async function save(ctx, changes) {
    try {
        await ctx.saveLedger({ ...ctx.state.ledger.settings, ...changes });
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}

// ---------------------------------------------------------------- day rule

function dayRuleSection(ctx) {
    const current = ctx.state.ledger.settings.dayRule;
    return h('fieldset', { class: 'day-rule' },
        h('legend', {}, t('How days count')),
        Object.entries(DAY_RULES).map(([value, rule]) => h('label', { class: `radio-card${value === current ? ' is-checked' : ''}` },
            h('input', {
                type: 'radio',
                name: 'day-rule',
                value,
                checked: value === current,
                onchange: async () => {
                    if (await save(ctx, { dayRule: value })) toast(t('Counting days: {rule}.', { rule: rule.label }), { tone: 'success' });
                }
            }),
            h('span', {}, h('strong', {}, rule.label), h('small', {}, rule.description))
        )),
        h('p', { class: 'muted small' }, t('Used for day counters, tax thresholds and the evidence report. Schengen always counts any part of a day.'))
    );
}

// ---------------------------------------------------------------- alerts and notes

function alertsSection(overview) {
    if (!overview.alerts.length) return null;
    return h('section', { class: 'ledger-alerts', 'aria-labelledby': 'ledger-alerts-title' },
        h('h3', { id: 'ledger-alerts-title' }, h('span', { 'aria-hidden': 'true' }, '🚨 '), t('Heads up')),
        h('ul', {}, overview.alerts.map(alert => h('li', { class: `alert alert-${alert.level}` },
            h('span', { 'aria-hidden': 'true' }, alert.level === 'reached' ? '⛔' : '⚠️'),
            h('span', {}, alert.message)
        ))),
        h('p', { class: 'muted small' }, t('Alerts show here and when you sign in. Email alerts are not available yet.'))
    );
}

function dataNotes(overview) {
    const notes = [];
    if (overview.unrecorded) {
        notes.push(tn(overview.unrecorded,
            '{count} visit has no last day, so it counts as one day. Add the last day, or tick “I\'m still there” on a stay that is still going on.',
            '{count} visits have no last day, so they count as one day. Add the last day, or tick “I\'m still there” on a stay that is still going on.'));
    }
    if (overview.unplaced) {
        notes.push(tn(overview.unplaced, '{count} dated place lies outside every country on the map and is not counted.',
            '{count} dated places lie outside every country on the map and are not counted.'));
    }
    return notes.length ? h('div', { class: 'ledger-note' }, notes.map(note => h('p', { class: 'small' }, note))) : null;
}

// ---------------------------------------------------------------- Schengen

function entryResult(days, entry) {
    if (!entry) return t('Choose a day to see how long you could stay.');
    const day = dayNumber(entry);
    const stay = maxStayFrom(days, SCHENGEN_RULE, day);
    if (!stay.days) return t('Not on {date}: the 180 days up to then already hold 90 days in the area.', { date: formatDate(entry) });
    const until = formatDate(isoDay(stay.lastDay));
    // Already in the area that day: the day itself is counted, so say how many more follow.
    if (days.includes(day)) return t('Staying on from {date}, you could stay until {until}, {days} more.', { date: formatDate(entry), until, days: dayCount(stay.days - 1) });
    return t('From {date} you could stay {days}, until {until}.', { date: formatDate(entry), days: dayCount(stay.days), until });
}

function schengenSection(ctx, overview) {
    const schengen = overview.stays.find(item => item.rule.id === SCHENGEN_RULE.id);
    const days = daysIn(overview.presence, SCHENGEN_RULE.countries);
    const today = localToday();
    const entry = view.entry || today;
    const result = h('p', { class: 'entry-result', 'aria-live': 'polite' }, entryResult(days, entry));
    const names = ids => ids.map(id => countryName(ctx, id)).sort().join(', ');

    return h('section', { class: 'schengen-card', 'aria-labelledby': 'schengen-title' },
        h('div', { class: 'schengen-head' },
            h('div', {},
                h('p', { class: 'eyebrow' }, t('Short-stay calculator')),
                h('h3', { id: 'schengen-title' }, t('Schengen 90/180'))
            ),
            h('p', { class: 'days-left' }, h('strong', {}, schengen.remaining), h('small', {}, t('days left today')))
        ),
        meter(schengen.used, 90, t('Schengen days used: {used} of 90', { used: schengen.used })),
        h('p', { class: 'small' },
            t('{used} of 90 in the area in the 180 days up to today.', { used: dayCount(schengen.used) }),
            schengen.inside ? ` ${t('You are in the area now.')}` : ''),
        schengen.breaches.length ? h('p', { class: 'small form-error' },
            t('Over the limit on {days}, first on {date}.', { days: dayCount(schengen.breaches.length), date: formatDate(isoDay(schengen.breaches[0])) })) : null,
        h('label', { class: 'field entry-field', for: 'schengen-entry' },
            h('span', {}, t('If I enter on')),
            h('input', {
                id: 'schengen-entry',
                type: 'date',
                value: entry,
                oninput: event => {
                    view.entry = event.target.value;
                    result.textContent = entryResult(days, view.entry);
                }
            })
        ),
        result,
        h('details', { class: 'small' },
            h('summary', {}, t('Which countries count?')),
            h('p', {}, t('Members: {SCHENGEN_MEMBERS}.', { SCHENGEN_MEMBERS: names(SCHENGEN_MEMBERS) })),
            h('p', {}, t('Also counted, as they are only reached through the area: {SCHENGEN_OPEN_BORDERS}.', { SCHENGEN_OPEN_BORDERS: names(SCHENGEN_OPEN_BORDERS) })),
            h('p', {}, t('Not counted: Cyprus and Ireland (EU members outside the area) and Andorra. Entry and exit days both count.')),
            h('p', {}, t('Overseas territories outside the area, such as French Guiana, Réunion or Svalbard, are territories of their own on the map and do not count.'))
        )
    );
}

// ---------------------------------------------------------------- planned stays

async function plannedStayDialog(ctx) {
    const countries = [...ctx.state.index.countries].sort((a, b) => a.name.localeCompare(b.name));
    /** @type {Record<string, any>} */
    let draft = { startDate: addDays(localToday(), 7), endDate: addDays(localToday(), 14), countryId: '' };
    for (;;) {
        const values = await formDialog({
            title: t('Plan a stay'),
            message: t('Try a future stay against your rules. It is not saved as a visit.'),
            submitLabel: t('Add to plan'),
            fields: [
                { name: 'countryId', label: t('Country'), type: 'select', value: draft.countryId, options: [
                    { value: '', label: t('Choose a country') },
                    ...countries.map(country => ({ value: country.id, label: country.name }))
                ] },
                { name: 'startDate', label: t('First day'), type: 'date', value: draft.startDate, required: true },
                { name: 'endDate', label: t('Last day'), type: 'date', value: draft.endDate, required: true }
            ]
        });
        if (!values) return null;
        const { stay, error } = checkPlannedStay({ ...values, id: newId() });
        if (!error) return stay;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

// A planned stay that follows a trip (its id is "trip-<id>", or "trip-<id>-<n>" for a later
// country) is named after it.
function tripTitle(ctx, stay) {
    return ctx.state.trips.find(trip => isTripPlan(trip, stay.id))?.title || '';
}

function plansSection(ctx, overview) {
    const { planned } = ctx.state.ledger.settings;
    const { plans } = overview;
    const add = async () => {
        const stay = await plannedStayDialog(ctx);
        if (stay && await save(ctx, { planned: [...planned, stay] })) toast(t('Planned stay added.'), { tone: 'success' });
    };
    const remove = stay => save(ctx, { planned: planned.filter(item => item.id !== stay.id) });

    return h('section', { 'aria-labelledby': 'plans-title' },
        h('h3', { class: 'section-title', id: 'plans-title' }, t('Plan ahead'), h('span', { class: 'count' }, planned.length)),
        planned.length ? h('ul', { class: 'ledger-list' }, planned.map(stay => h('li', { class: 'ledger-item' },
            h('span', { class: 'ledger-item-text' },
                h('strong', {}, countryLabel(ctx, stay.countryId)),
                h('small', {}, `${spanLabel(stay.startDate, stay.endDate)} · ${dayCount(dayNumber(stay.endDate) - dayNumber(stay.startDate) + 1)}`,
                    tripTitle(ctx, stay) ? ` · ${t('trip “{title}”', { title: tripTitle(ctx, stay) })}` : '')),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove the planned stay in {country}', { country: countryName(ctx, stay.countryId) }), title: t('Remove'), onclick: () => remove(stay) }, '🗑️')
        ))) : h('p', { class: 'muted small' }, t('Add a future stay to see whether it fits your visa rules and thresholds.')),
        plans.stays.length || plans.thresholds.length ? h('ul', { class: 'plan-outcomes' },
            plans.stays.map(item => h('li', { class: item.fits ? 'is-ok' : 'is-over' },
                h('span', { 'aria-hidden': 'true' }, item.fits ? '✅' : '❌'),
                h('span', {}, item.fits
                    ? t('{name}: fits, with {remaining} left on {lastDay}.', { name: item.rule.name, remaining: dayCount(item.remaining), lastDay: formatDate(item.lastDay) })
                    : t('{name}: over the limit from {firstBreach}.', { name: item.rule.name, firstBreach: formatDate(item.firstBreach) }))
            )),
            plans.thresholds.map(item => h('li', { class: item.reached ? 'is-over' : 'is-ok' },
                h('span', { 'aria-hidden': 'true' }, item.reached ? '⛔' : '📊'),
                h('span', {}, t(item.reached ? '{name}: {count} of {maxDays} days from {from} to {to}, threshold reached.' : '{name}: {count} of {maxDays} days from {from} to {to}.', { name: item.rule.builtIn ? countryName(ctx, item.countries[0]) : item.rule.name, count: item.count, maxDays: item.rule.maxDays, from: formatDate(item.period.from), to: formatDate(item.period.to) }))
            ))
        ) : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: add }, t('＋ Plan a stay'))
    );
}

// ---------------------------------------------------------------- rules

function countryNames(ctx, ids) {
    return ids.map(id => countryName(ctx, id)).join(', ');
}

export async function ruleDialog(ctx, kind, rule) {
    const stay = kind === 'stay';
    let draft = rule ? { ...rule, countries: countryNames(ctx, rule.countries) } : {
        name: '', countries: '', maxDays: stay ? 90 : 183, windowDays: stay ? 180 : 365,
        warnDays: stay ? 10 : 30, dayRule: 'presence', period: 'year', yearStart: '01-01'
    };
    const fields = () => [
        { name: 'name', label: t('Name'), value: draft.name, required: true, maxlength: 80, placeholder: stay ? t('Turkey e-visa 90/180') : t('Spain tax residency') },
        { name: 'countries', label: t('Countries'), value: draft.countries, required: true, hint: t('Names separated by commas, counted together. “Schengen” adds every Schengen country.') },
        { name: 'maxDays', label: stay ? t('Days allowed') : t('Threshold days'), type: 'number', value: draft.maxDays, required: true, min: 1, max: 3660 },
        ...(stay ? [
            { name: 'windowDays', label: t('In any window of (days)'), type: 'number', value: draft.windowDays, required: true, min: 1, max: 3660 },
            { name: 'dayRule', label: t('Days count'), type: 'select', value: draft.dayRule, options: Object.entries(DAY_RULES).map(([value, item]) => ({ value, label: item.label })) }
        ] : [
            { name: 'period', label: t('Counted over'), type: 'select', value: draft.period, options: [
                { value: 'year', label: t('A calendar or tax year') },
                { value: 'rolling', label: t('A rolling window') }
            ] },
            { name: 'yearStart', label: t('Year starts on (MM-DD)'), value: draft.yearStart || '01-01', placeholder: '01-01', maxlength: 5, hint: t('For a year: 01-01 for a calendar year, 04-06 for the UK tax year.') },
            { name: 'windowDays', label: t('Rolling window (days)'), type: 'number', value: draft.windowDays || 365, min: 1, max: 3660, hint: t('For a rolling window only.') }
        ]),
        { name: 'warnDays', label: stay ? t('Warn me when this many days are left') : t('Warn me this many days before'), type: 'number', value: draft.warnDays, min: 0, max: 365 }
    ];
    for (;;) {
        const values = await formDialog({
            title: rule ? t('Edit {name}', { name: rule.name }) : stay ? t('Add a stay rule') : t('Add a threshold'),
            message: stay ? t('For visas and stay limits: at most so many days in any window of days.') : t('For tax residency and similar thresholds: so many days in a year or a rolling window.'),
            submitLabel: rule ? t('Save rule') : t('Add rule'),
            fields: fields()
        });
        if (!values) return null;
        const { ids, unknown } = parseCountryList(values.countries, name => ctx.state.index.findByName(name) || ctx.state.index.byId.get(name.toUpperCase()));
        const { rule: checked, error } = unknown.length
            ? { error: tn(unknown.length, 'Unknown country: {names}.', 'Unknown countries: {names}.', { names: unknown.join(', ') }) }
            : checkRule({ ...values, kind, id: rule?.id || newId() }, ids);
        if (!error) return checked;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

function ruleActions(ctx, rule) {
    const { rules } = ctx.state.ledger.settings;
    const edit = async () => {
        const updated = await ruleDialog(ctx, rule.kind, rule);
        if (updated && await save(ctx, { rules: rules.map(item => (item.id === rule.id ? updated : item)) })) toast(t('Rule saved.'), { tone: 'success' });
    };
    const remove = async () => {
        if (await save(ctx, { rules: rules.filter(item => item.id !== rule.id) })) {
            toast(t('Removed {name}.', { name: rule.name }), { action: { label: t('Undo'), run: () => save(ctx, { rules: [...ctx.state.ledger.settings.rules, rule] }) } });
        }
    };
    return h('span', { class: 'ledger-item-actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Edit {name}', { name: rule.name }), title: t('Edit'), onclick: edit }, '✏️'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove {name}', { name: rule.name }), title: t('Remove'), onclick: remove }, '🗑️')
    );
}

function addRuleButton(ctx, kind, label) {
    return h('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        onclick: async () => {
            const rule = await ruleDialog(ctx, kind);
            if (rule && await save(ctx, { rules: [...ctx.state.ledger.settings.rules, rule] })) toast(t('Added {name}.', { name: rule.name }), { tone: 'success' });
        }
    }, label);
}

function staysSection(ctx, overview) {
    const custom = overview.stays.filter(item => !item.rule.builtIn);
    return h('section', { 'aria-labelledby': 'stay-rules-title' },
        h('h3', { class: 'section-title', id: 'stay-rules-title' }, t('Visa and stay rules'), h('span', { class: 'count' }, custom.length)),
        custom.length ? h('ul', { class: 'ledger-list' }, custom.map(item => h('li', { class: 'ledger-item' },
            h('span', { class: 'ledger-item-text' },
                h('strong', {}, item.rule.name),
                h('small', {}, t('{maxDays} days in any {windowDays} · {countries}', { maxDays: item.rule.maxDays, windowDays: item.rule.windowDays, countries: countryNames(ctx, item.rule.countries) })),
                meter(item.used, item.rule.maxDays, t('{name}: {used} of {maxDays} days used', { name: item.rule.name, used: item.used, maxDays: item.rule.maxDays })),
                h('small', {}, t('{used} used, {remaining} left today', { used: dayCount(item.used), remaining: dayCount(item.remaining) }),
                    item.stay.days && item.inside ? t('; you could stay until {date}', { date: formatDate(isoDay(item.stay.lastDay)) }) : '',
                    item.recentBreach !== null ? t('. Over the limit within the current window.') : '')
            ),
            ruleActions(ctx, item.rule)
        ))) : h('p', { class: 'muted small' }, t('Add your own rule, such as 90 days in any 180 for a visa, or 30 in any 60 for a country group.')),
        addRuleButton(ctx, 'stay', t('＋ Add a stay rule'))
    );
}

function thresholdLine(ctx, item) {
    const values = { count: item.count, maxDays: item.rule.maxDays, from: formatDate(item.period.from), to: formatDate(item.period.to), date: formatDate(item.reachDate) };
    if (item.status === 'reached' && item.reachDate) return t('{count} of {maxDays} days from {from} to {to}, reached on {date}', values);
    if (item.reachDate && item.stillThere) return t('{count} of {maxDays} days from {from} to {to}, would be reached on {date} if you stay on', values);
    if (item.reachDate) return t('{count} of {maxDays} days from {from} to {to}, would be reached on {date}', values);
    return t('{count} of {maxDays} days from {from} to {to}', values);
}

function thresholdsSection(ctx, overview) {
    const builtIn = overview.thresholds.filter(item => item.rule.builtIn);
    const custom = overview.thresholds.filter(item => !item.rule.builtIn);
    const year = new Date().getFullYear();
    return h('section', { 'aria-labelledby': 'thresholds-title' },
        h('h3', { class: 'section-title', id: 'thresholds-title' }, t('Tax residency')),
        h('p', { class: 'muted small' }, t('Many countries treat {maxDays} days in a year as tax residency. The ledger warns {warnDays} days ahead; check the exact rule with an adviser.', { maxDays: TAX_RESIDENCY_RULE.maxDays, warnDays: TAX_RESIDENCY_RULE.warnDays })),
        h('ul', { class: 'ledger-list' },
            builtIn.map(item => h('li', { class: 'ledger-item' },
                h('span', { class: 'ledger-item-text' },
                    h('strong', {}, countryLabel(ctx, item.countries[0])),
                    meter(item.count, item.rule.maxDays, t('{country}: {count} of {maxDays} days in {year}', { country: countryName(ctx, item.countries[0]), count: item.count, maxDays: item.rule.maxDays, year })),
                    h('small', {}, thresholdLine(ctx, item))
                ),
                statusChip(item.status)
            )),
            custom.map(item => h('li', { class: 'ledger-item' },
                h('span', { class: 'ledger-item-text' },
                    h('strong', {}, item.rule.name, ' ', statusChip(item.status)),
                    h('small', {}, `${item.rule.period === 'year' ? t('Year from {date}', { date: item.rule.yearStart }) : t('Any {windowDays} days', { windowDays: item.rule.windowDays })} · ${countryNames(ctx, item.rule.countries)}`),
                    meter(item.count, item.rule.maxDays, t('{name}: {count} of {maxDays} days', { name: item.rule.name, count: item.count, maxDays: item.rule.maxDays })),
                    h('small', {}, thresholdLine(ctx, item))
                ),
                ruleActions(ctx, item.rule)
            ))
        ),
        builtIn.length || custom.length ? null : h('p', { class: 'muted small' }, t('No days recorded in {year} yet.', { year })),
        addRuleButton(ctx, 'threshold', t('＋ Add a threshold'))
    );
}

// ---------------------------------------------------------------- counters and timeline

function counterPeriods(overview) {
    const today = localToday();
    const years = new Set([today.slice(0, 4)]);
    for (const stay of overview.timeline) {
        for (let year = Number(stay.from.slice(0, 4)); year <= Number(stay.to.slice(0, 4)); year += 1) years.add(String(year));
    }
    const yearOptions = [...years].filter(year => year <= today.slice(0, 4)).sort().reverse()
        .map(year => ({ value: `year:${year}`, label: year === today.slice(0, 4) ? t('This year ({year})', { year }) : year, from: `${year}-01-01`, to: `${year}-12-31` }));
    const rolling = [365, 180, 90].map(windowDays => ({
        value: `rolling:${windowDays}`, label: t('Last {windowDays} days', { windowDays }), from: addDays(today, 1 - windowDays), to: today
    }));
    return [...yearOptions, ...rolling];
}

function countersSection(ctx, overview) {
    const periods = counterPeriods(overview);
    const period = periods.find(item => item.value === view.period) || periods[0];
    const rows = countryCounters(overview.ledger, period.from, period.to);
    const max = Math.max(1, ...rows.map(row => row.days));
    return h('section', { 'aria-labelledby': 'counters-title' },
        h('div', { class: 'section-head' },
            h('h3', { class: 'section-title', id: 'counters-title' }, t('Days per country')),
            h('label', { class: 'sort' }, h('span', { class: 'visually-hidden' }, t('Counting period')),
                h('select', {
                    id: 'counter-period',
                    onchange: event => {
                        view.period = event.target.value;
                        rerender(ctx, 'counter-period');
                    }
                }, periods.map(item => h('option', { value: item.value, selected: item.value === period.value }, item.label))))
        ),
        rows.length ? h('table', { class: 'counter-table' },
            h('caption', { class: 'visually-hidden' }, t('Days per country: {period}', { period: period.label })),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('Country')), h('th', { scope: 'col' }, t('Days')))),
            h('tbody', {}, rows.map(row => h('tr', {},
                h('th', { scope: 'row' }, countryLabel(ctx, row.countryId)),
                h('td', {}, h('span', { class: 'counter-cell' },
                    h('span', { class: 'counter-bar', 'aria-hidden': 'true', style: `width:${Math.max(6, Math.round((row.days / max) * 80))}%` }),
                    h('strong', {}, row.days)))
            )))
        ) : h('p', { class: 'muted small' }, t('No days recorded in this period.'))
    );
}

function sourceLine(source) {
    const dates = source.endDate
        ? spanLabel(source.startDate, source.endDate)
        : `${formatDate(source.startDate)} – ${source.ongoing ? t('still there') : t('last day not recorded')}`;
    return `${source.place.split(',')[0]} (${dates})`;
}

function timelineSection(ctx, overview) {
    const stays = overview.timeline;
    const shown = view.showAllStays ? stays : stays.slice(0, STAYS_SHOWN);
    return h('section', { 'aria-labelledby': 'timeline-title' },
        h('h3', { class: 'section-title', id: 'timeline-title' }, t('Timeline'), h('span', { class: 'count' }, stays.length)),
        stays.length ? h('ol', { class: 'timeline' }, shown.map(stay => h('li', { class: `timeline-stay${stay.ongoing ? ' is-ongoing' : ''}` },
            h('strong', {}, countryLabel(ctx, stay.countryId)),
            h('span', { class: 'timeline-dates' }, `${spanLabel(stay.from, stay.to)} · ${dayCount(stay.days)}`),
            stay.ongoing ? h('span', { class: 'chip chip-ok' }, t('Still there')) : null,
            stay.unrecorded ? h('span', { class: 'chip chip-warn' }, t('Last day missing')) : null,
            h('small', {}, stay.sources.map(sourceLine).join(' · '))
        ))) : h('p', { class: 'muted small' }, t('Add dated visits to your places and each stay shows here, with entry and exit days per country and city.')),
        stays.length > STAYS_SHOWN ? h('button', {
            type: 'button',
            id: 'timeline-toggle',
            class: 'link-btn',
            onclick: () => {
                view.showAllStays = !view.showAllStays;
                rerender(ctx, 'timeline-toggle');
            }
        }, view.showAllStays ? t('Show fewer stays') : tn(stays.length, 'Show the {count} stay', 'Show all {count} stays')) : null
    );
}

// ---------------------------------------------------------------- tab

// The ledger's privacy statement (ADR 0017): what is stored, at what precision, and where the
// counting happens.
function privacyNote() {
    return h('details', { class: 'small', id: 'ledger-privacy' },
        h('summary', {}, t('How your ledger data is kept')),
        h('p', {}, t('Places are saved as a town or a country with the map\'s coordinates for it, never your precise location. A place found through the world search is rounded to about a kilometer; only coordinates you import yourself are kept as they are in the file.')),
        h('p', {}, t('Days, rules, thresholds and alerts are counted on this device. Evidence reports are made here only when you ask, and are never sent to the server or stored there.')),
        h('p', {}, t('The server keeps your visits, your ledger settings and the history of visit dates, so reports can show every change. None of it is ever on your public map, and deleting your account deletes all of it.'))
    );
}

export function renderLedger(container, ctx) {
    const overview = ctx.currentLedger();
    const counted = overview.ledger.countries.size;
    const history = h('div', {}, historySection(ctx));

    fill(container,
        h('div', { class: 'section-head' },
            h('h2', {}, t('Day ledger')),
            h('p', { class: 'muted small' }, counted ? tn(counted, '{count} country', '{count} countries') : t('No dated visits yet'))
        ),
        h('p', { class: 'muted small' }, t('Every dated visit turns into days in a country; a city counts for its country. Add visits from any place card.')),
        h('p', { class: 'muted small', id: 'ledger-advice' }, adviceNote()),
        privacyNote(),
        alertsSection(overview),
        dataNotes(overview),
        schengenSection(ctx, overview),
        plansSection(ctx, overview),
        staysSection(ctx, overview),
        thresholdsSection(ctx, overview),
        orgRulesSections(ctx),
        countersSection(ctx, overview),
        timelineSection(ctx, overview),
        whereSection(ctx, overview),
        reportSection(ctx, overview),
        history,
        dayRuleSection(ctx)
    );

    // The history arrives a moment later and fills in its own section only.
    if (!ctx.state.ledger.changes) {
        ctx.loadVisitChanges()
            .then(() => fill(history, historySection(ctx)))
            .catch(() => fill(history, h('p', { class: 'muted small' }, t('The date history could not be loaded.'))));
    }
}

// Redraws the tab after a view change and keeps focus on the control that made it.
function rerender(ctx, focusId) {
    ctx.selectTab('ledger');
    document.getElementById(focusId)?.focus();
}
