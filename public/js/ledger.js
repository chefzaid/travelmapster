// Ledger tab: days per country from dated visits, the Schengen 90/180 calculator, stay
// rules, tax-residency thresholds and planned stays; the evidence report and date history are
// in ledger-report.js. The counting lives in days.js; these modules only draw it.
import { h, fill, toast, formDialog, formatDate } from './ui.js';
import {
    DAY_RULES, SCHENGEN_RULE, SCHENGEN_MEMBERS, SCHENGEN_OPEN_BORDERS, TAX_RESIDENCY_RULE,
    addDays, checkPlannedStay, checkRule, countryCounters, dayNumber, daysIn,
    isoDay, localToday, maxStayFrom, newId, parseCountryList
} from './days.js';
import { ADVICE_NOTE, countryName, historySection, reportSection } from './ledger-report.js';

const view = { entry: '', period: '', showAllStays: false };
const STAYS_SHOWN = 12;

const dayCount = count => (count === 1 ? '1 day' : `${count} days`);

function countryLabel(ctx, id) {
    const country = ctx.state.index.byId.get(id);
    return country ? `${country.flag} ${country.name}` : id;
}

function spanLabel(from, to) {
    return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

function statusChip(status) {
    const labels = { ok: ['chip-ok', '✓ On track'], warning: ['chip-warn', '⚠ Getting close'], reached: ['chip-over', '⛔ Reached'] };
    const [tone, label] = labels[status];
    return h('span', { class: `chip ${tone}` }, label);
}

function meter(value, max, label) {
    const percent = Math.min(100, Math.round((value / max) * 100));
    return h('span', {
        class: `meter${value >= max ? ' is-full' : percent >= 80 ? ' is-high' : ''}`,
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': String(max),
        'aria-valuenow': String(Math.min(value, max)),
        'aria-label': label
    }, h('span', { style: `width:${percent}%` }));
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
        h('legend', {}, 'How days count'),
        Object.entries(DAY_RULES).map(([value, rule]) => h('label', { class: `radio-card${value === current ? ' is-checked' : ''}` },
            h('input', {
                type: 'radio',
                name: 'day-rule',
                value,
                checked: value === current,
                onchange: async () => {
                    if (await save(ctx, { dayRule: value })) toast(`Counting by the ${rule.label.toLowerCase()} rule.`, { tone: 'success' });
                }
            }),
            h('span', {}, h('strong', {}, rule.label), h('small', {}, rule.description))
        )),
        h('p', { class: 'muted small' }, 'Used for day counters, tax thresholds and the evidence report. Schengen always counts any part of a day.')
    );
}

// ---------------------------------------------------------------- alerts and notes

function alertsSection(overview) {
    if (!overview.alerts.length) return null;
    return h('section', { class: 'ledger-alerts', 'aria-labelledby': 'ledger-alerts-title' },
        h('h3', { id: 'ledger-alerts-title' }, h('span', { 'aria-hidden': 'true' }, '🚨 '), 'Heads up'),
        h('ul', {}, overview.alerts.map(alert => h('li', { class: `alert alert-${alert.level}` },
            h('span', { 'aria-hidden': 'true' }, alert.level === 'reached' ? '⛔' : '⚠️'),
            h('span', {}, alert.message)
        ))),
        h('p', { class: 'muted small' }, 'Alerts show here and when you sign in. Email alerts are not available yet.')
    );
}

function dataNotes(overview) {
    const notes = [];
    if (overview.unrecorded) {
        notes.push(`${overview.unrecorded} ${overview.unrecorded === 1 ? 'visit has' : 'visits have'} no last day, so ${overview.unrecorded === 1 ? 'it counts' : 'they count'} as one day. Add the last day, or tick “I'm still there” on a stay that is still going on.`);
    }
    if (overview.unplaced) notes.push(`${overview.unplaced} dated ${overview.unplaced === 1 ? 'place lies' : 'places lie'} outside every country on the map and ${overview.unplaced === 1 ? 'is' : 'are'} not counted.`);
    return notes.length ? h('div', { class: 'ledger-note' }, notes.map(note => h('p', { class: 'small' }, note))) : null;
}

// ---------------------------------------------------------------- Schengen

function entryResult(days, entry) {
    if (!entry) return 'Choose a day to see how long you could stay.';
    const day = dayNumber(entry);
    const stay = maxStayFrom(days, SCHENGEN_RULE, day);
    if (!stay.days) return `Not on ${formatDate(entry)}: the 180 days up to then already hold 90 days in the area.`;
    const until = formatDate(isoDay(stay.lastDay));
    // Already in the area that day: the day itself is counted, so say how many more follow.
    if (days.includes(day)) return `Staying on from ${formatDate(entry)}, you could stay until ${until}, ${dayCount(stay.days - 1)} more.`;
    return `From ${formatDate(entry)} you could stay ${dayCount(stay.days)}, until ${until}.`;
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
                h('p', { class: 'eyebrow' }, 'Short-stay calculator'),
                h('h3', { id: 'schengen-title' }, 'Schengen 90/180')
            ),
            h('p', { class: 'days-left' }, h('strong', {}, schengen.remaining), h('small', {}, 'days left today'))
        ),
        meter(schengen.used, 90, `Schengen days used: ${schengen.used} of 90`),
        h('p', { class: 'small' },
            `${dayCount(schengen.used)} of 90 in the area in the 180 days up to today.`,
            schengen.inside ? ' You are in the area now.' : ''),
        schengen.breaches.length ? h('p', { class: 'small form-error' },
            `Over the limit on ${dayCount(schengen.breaches.length)}, first on ${formatDate(isoDay(schengen.breaches[0]))}.`) : null,
        h('label', { class: 'field entry-field', for: 'schengen-entry' },
            h('span', {}, 'If I enter on'),
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
            h('summary', {}, 'Which countries count?'),
            h('p', {}, `Members: ${names(SCHENGEN_MEMBERS)}.`),
            h('p', {}, `Also counted, as they are only reached through the area: ${names(SCHENGEN_OPEN_BORDERS)}.`),
            h('p', {}, 'Not counted: Cyprus and Ireland (EU members outside the area) and Andorra. Entry and exit days both count.'),
            h('p', {}, 'Overseas territories that the map draws as part of a member, such as French Guiana, count with it although they are outside the area.')
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
            title: 'Plan a stay',
            message: 'Try a future stay against your rules. It is not saved as a visit.',
            submitLabel: 'Add to plan',
            fields: [
                { name: 'countryId', label: 'Country', type: 'select', value: draft.countryId, options: [
                    { value: '', label: 'Choose a country' },
                    ...countries.map(country => ({ value: country.id, label: country.name }))
                ] },
                { name: 'startDate', label: 'First day', type: 'date', value: draft.startDate, required: true },
                { name: 'endDate', label: 'Last day', type: 'date', value: draft.endDate, required: true }
            ]
        });
        if (!values) return null;
        const { stay, error } = checkPlannedStay({ ...values, id: newId() });
        if (!error) return stay;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

// A planned stay that follows a trip (its id is "trip-<id>") is named after it.
function tripTitle(ctx, stay) {
    return ctx.state.trips.find(trip => `trip-${trip.id}` === stay.id)?.title || '';
}

function plansSection(ctx, overview) {
    const { planned } = ctx.state.ledger.settings;
    const { plans } = overview;
    const add = async () => {
        const stay = await plannedStayDialog(ctx);
        if (stay && await save(ctx, { planned: [...planned, stay] })) toast('Planned stay added.', { tone: 'success' });
    };
    const remove = stay => save(ctx, { planned: planned.filter(item => item.id !== stay.id) });

    return h('section', { 'aria-labelledby': 'plans-title' },
        h('h3', { class: 'section-title', id: 'plans-title' }, 'Plan ahead', h('span', { class: 'count' }, planned.length)),
        planned.length ? h('ul', { class: 'ledger-list' }, planned.map(stay => h('li', { class: 'ledger-item' },
            h('span', { class: 'ledger-item-text' },
                h('strong', {}, countryLabel(ctx, stay.countryId)),
                h('small', {}, `${spanLabel(stay.startDate, stay.endDate)} · ${dayCount(dayNumber(stay.endDate) - dayNumber(stay.startDate) + 1)}`,
                    tripTitle(ctx, stay) ? ` · trip “${tripTitle(ctx, stay)}”` : '')),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove the planned stay in ${countryName(ctx, stay.countryId)}`, title: 'Remove', onclick: () => remove(stay) }, '🗑️')
        ))) : h('p', { class: 'muted small' }, 'Add a future stay to see whether it fits your visa rules and thresholds.'),
        plans.stays.length || plans.thresholds.length ? h('ul', { class: 'plan-outcomes' },
            plans.stays.map(item => h('li', { class: item.fits ? 'is-ok' : 'is-over' },
                h('span', { 'aria-hidden': 'true' }, item.fits ? '✅' : '❌'),
                h('span', {}, item.fits
                    ? `${item.rule.name}: fits, with ${dayCount(item.remaining)} left on ${formatDate(item.lastDay)}.`
                    : `${item.rule.name}: over the limit from ${formatDate(item.firstBreach)}.`)
            )),
            plans.thresholds.map(item => h('li', { class: item.reached ? 'is-over' : 'is-ok' },
                h('span', { 'aria-hidden': 'true' }, item.reached ? '⛔' : '📊'),
                h('span', {}, `${item.rule.builtIn ? countryName(ctx, item.countries[0]) : item.rule.name}: ${item.count} of ${item.rule.maxDays} days from ${formatDate(item.period.from)} to ${formatDate(item.period.to)}${item.reached ? ', threshold reached' : ''}.`)
            ))
        ) : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: add }, '＋ Plan a stay')
    );
}

// ---------------------------------------------------------------- rules

function countryNames(ctx, ids) {
    return ids.map(id => countryName(ctx, id)).join(', ');
}

async function ruleDialog(ctx, kind, rule) {
    const stay = kind === 'stay';
    let draft = rule ? { ...rule, countries: countryNames(ctx, rule.countries) } : {
        name: '', countries: '', maxDays: stay ? 90 : 183, windowDays: stay ? 180 : 365,
        warnDays: stay ? 10 : 30, dayRule: 'presence', period: 'year', yearStart: '01-01'
    };
    const fields = () => [
        { name: 'name', label: 'Name', value: draft.name, required: true, maxlength: 80, placeholder: stay ? 'Turkey e-visa 90/180' : 'Spain tax residency' },
        { name: 'countries', label: 'Countries', value: draft.countries, required: true, hint: 'Names separated by commas, counted together. “Schengen” adds every Schengen country.' },
        { name: 'maxDays', label: stay ? 'Days allowed' : 'Threshold days', type: 'number', value: draft.maxDays, required: true, min: 1, max: 3660 },
        ...(stay ? [
            { name: 'windowDays', label: 'In any window of (days)', type: 'number', value: draft.windowDays, required: true, min: 1, max: 3660 },
            { name: 'dayRule', label: 'Days count', type: 'select', value: draft.dayRule, options: Object.entries(DAY_RULES).map(([value, item]) => ({ value, label: item.label })) }
        ] : [
            { name: 'period', label: 'Counted over', type: 'select', value: draft.period, options: [
                { value: 'year', label: 'A calendar or tax year' },
                { value: 'rolling', label: 'A rolling window' }
            ] },
            { name: 'yearStart', label: 'Year starts on (MM-DD)', value: draft.yearStart || '01-01', placeholder: '01-01', maxlength: 5, hint: 'For a year: 01-01 for a calendar year, 04-06 for the UK tax year.' },
            { name: 'windowDays', label: 'Rolling window (days)', type: 'number', value: draft.windowDays || 365, min: 1, max: 3660, hint: 'For a rolling window only.' }
        ]),
        { name: 'warnDays', label: stay ? 'Warn me when this many days are left' : 'Warn me this many days before', type: 'number', value: draft.warnDays, min: 0, max: 365 }
    ];
    for (;;) {
        const values = await formDialog({
            title: rule ? `Edit ${rule.name}` : stay ? 'Add a stay rule' : 'Add a threshold',
            message: stay ? 'For visas and stay limits: at most so many days in any window of days.' : 'For tax residency and similar thresholds: so many days in a year or a rolling window.',
            submitLabel: rule ? 'Save rule' : 'Add rule',
            fields: fields()
        });
        if (!values) return null;
        const { ids, unknown } = parseCountryList(values.countries, name => ctx.state.index.findByName(name) || ctx.state.index.byId.get(name.toUpperCase()));
        const { rule: checked, error } = unknown.length
            ? { error: `Unknown ${unknown.length === 1 ? 'country' : 'countries'}: ${unknown.join(', ')}.` }
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
        if (updated && await save(ctx, { rules: rules.map(item => (item.id === rule.id ? updated : item)) })) toast('Rule saved.', { tone: 'success' });
    };
    const remove = async () => {
        if (await save(ctx, { rules: rules.filter(item => item.id !== rule.id) })) {
            toast(`Removed ${rule.name}.`, { action: { label: 'Undo', run: () => save(ctx, { rules: [...ctx.state.ledger.settings.rules, rule] }) } });
        }
    };
    return h('span', { class: 'ledger-item-actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${rule.name}`, title: 'Edit', onclick: edit }, '✏️'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${rule.name}`, title: 'Remove', onclick: remove }, '🗑️')
    );
}

function addRuleButton(ctx, kind, label) {
    return h('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        onclick: async () => {
            const rule = await ruleDialog(ctx, kind);
            if (rule && await save(ctx, { rules: [...ctx.state.ledger.settings.rules, rule] })) toast(`Added ${rule.name}.`, { tone: 'success' });
        }
    }, label);
}

function staysSection(ctx, overview) {
    const custom = overview.stays.filter(item => !item.rule.builtIn);
    return h('section', { 'aria-labelledby': 'stay-rules-title' },
        h('h3', { class: 'section-title', id: 'stay-rules-title' }, 'Visa and stay rules', h('span', { class: 'count' }, custom.length)),
        custom.length ? h('ul', { class: 'ledger-list' }, custom.map(item => h('li', { class: 'ledger-item' },
            h('span', { class: 'ledger-item-text' },
                h('strong', {}, item.rule.name),
                h('small', {}, `${item.rule.maxDays} days in any ${item.rule.windowDays} · ${countryNames(ctx, item.rule.countries)}`),
                meter(item.used, item.rule.maxDays, `${item.rule.name}: ${item.used} of ${item.rule.maxDays} days used`),
                h('small', {}, `${dayCount(item.used)} used, ${dayCount(item.remaining)} left today`,
                    item.stay.days && item.inside ? `; you could stay until ${formatDate(isoDay(item.stay.lastDay))}` : '',
                    item.recentBreach !== null ? '. Over the limit within the current window.' : '')
            ),
            ruleActions(ctx, item.rule)
        ))) : h('p', { class: 'muted small' }, 'Add your own rule, such as 90 days in any 180 for a visa, or 30 in any 60 for a country group.'),
        addRuleButton(ctx, 'stay', '＋ Add a stay rule')
    );
}

function thresholdLine(ctx, item) {
    const parts = [`${item.count} of ${item.rule.maxDays} days from ${formatDate(item.period.from)} to ${formatDate(item.period.to)}`];
    if (item.status === 'reached' && item.reachDate) parts.push(`reached on ${formatDate(item.reachDate)}`);
    else if (item.reachDate) parts.push(`would be reached on ${formatDate(item.reachDate)}${item.stillThere ? ' if you stay on' : ''}`);
    return parts.join(', ');
}

function thresholdsSection(ctx, overview) {
    const builtIn = overview.thresholds.filter(item => item.rule.builtIn);
    const custom = overview.thresholds.filter(item => !item.rule.builtIn);
    const year = new Date().getFullYear();
    return h('section', { 'aria-labelledby': 'thresholds-title' },
        h('h3', { class: 'section-title', id: 'thresholds-title' }, 'Tax residency'),
        h('p', { class: 'muted small' }, `Many countries treat ${TAX_RESIDENCY_RULE.maxDays} days in a year as tax residency. The ledger warns ${TAX_RESIDENCY_RULE.warnDays} days ahead; check the exact rule with an adviser.`),
        h('ul', { class: 'ledger-list' },
            builtIn.map(item => h('li', { class: 'ledger-item' },
                h('span', { class: 'ledger-item-text' },
                    h('strong', {}, countryLabel(ctx, item.countries[0])),
                    meter(item.count, item.rule.maxDays, `${countryName(ctx, item.countries[0])}: ${item.count} of ${item.rule.maxDays} days in ${year}`),
                    h('small', {}, thresholdLine(ctx, item))
                ),
                statusChip(item.status)
            )),
            custom.map(item => h('li', { class: 'ledger-item' },
                h('span', { class: 'ledger-item-text' },
                    h('strong', {}, item.rule.name, ' ', statusChip(item.status)),
                    h('small', {}, `${item.rule.period === 'year' ? `Year from ${item.rule.yearStart}` : `Any ${item.rule.windowDays} days`} · ${countryNames(ctx, item.rule.countries)}`),
                    meter(item.count, item.rule.maxDays, `${item.rule.name}: ${item.count} of ${item.rule.maxDays} days`),
                    h('small', {}, thresholdLine(ctx, item))
                ),
                ruleActions(ctx, item.rule)
            ))
        ),
        builtIn.length || custom.length ? null : h('p', { class: 'muted small' }, `No days recorded in ${year} yet.`),
        addRuleButton(ctx, 'threshold', '＋ Add a threshold')
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
        .map(year => ({ value: `year:${year}`, label: year === today.slice(0, 4) ? `This year (${year})` : year, from: `${year}-01-01`, to: `${year}-12-31` }));
    const rolling = [365, 180, 90].map(windowDays => ({
        value: `rolling:${windowDays}`, label: `Last ${windowDays} days`, from: addDays(today, 1 - windowDays), to: today
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
            h('h3', { class: 'section-title', id: 'counters-title' }, 'Days per country'),
            h('label', { class: 'sort' }, h('span', { class: 'visually-hidden' }, 'Counting period'),
                h('select', {
                    id: 'counter-period',
                    onchange: event => {
                        view.period = event.target.value;
                        rerender(ctx, 'counter-period');
                    }
                }, periods.map(item => h('option', { value: item.value, selected: item.value === period.value }, item.label))))
        ),
        rows.length ? h('table', { class: 'counter-table' },
            h('caption', { class: 'visually-hidden' }, `Days per country, ${period.label.toLowerCase()}`),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Country'), h('th', { scope: 'col' }, 'Days'))),
            h('tbody', {}, rows.map(row => h('tr', {},
                h('th', { scope: 'row' }, countryLabel(ctx, row.countryId)),
                h('td', {}, h('span', { class: 'counter-cell' },
                    h('span', { class: 'counter-bar', 'aria-hidden': 'true', style: `width:${Math.max(6, Math.round((row.days / max) * 80))}%` }),
                    h('strong', {}, row.days)))
            )))
        ) : h('p', { class: 'muted small' }, 'No days recorded in this period.')
    );
}

function sourceLine(source) {
    const dates = source.endDate
        ? spanLabel(source.startDate, source.endDate)
        : `${formatDate(source.startDate)} – ${source.ongoing ? 'still there' : 'last day not recorded'}`;
    return `${source.place.split(',')[0]} (${dates})`;
}

function timelineSection(ctx, overview) {
    const stays = overview.timeline;
    const shown = view.showAllStays ? stays : stays.slice(0, STAYS_SHOWN);
    return h('section', { 'aria-labelledby': 'timeline-title' },
        h('h3', { class: 'section-title', id: 'timeline-title' }, 'Timeline', h('span', { class: 'count' }, stays.length)),
        stays.length ? h('ol', { class: 'timeline' }, shown.map(stay => h('li', { class: `timeline-stay${stay.ongoing ? ' is-ongoing' : ''}` },
            h('strong', {}, countryLabel(ctx, stay.countryId)),
            h('span', { class: 'timeline-dates' }, `${spanLabel(stay.from, stay.to)} · ${dayCount(stay.days)}`),
            stay.ongoing ? h('span', { class: 'chip chip-ok' }, 'Still there') : null,
            stay.unrecorded ? h('span', { class: 'chip chip-warn' }, 'Last day missing') : null,
            h('small', {}, stay.sources.map(sourceLine).join(' · '))
        ))) : h('p', { class: 'muted small' }, 'Add dated visits to your places and each stay shows here, with entry and exit days per country and city.'),
        stays.length > STAYS_SHOWN ? h('button', {
            type: 'button',
            id: 'timeline-toggle',
            class: 'link-btn',
            onclick: () => {
                view.showAllStays = !view.showAllStays;
                rerender(ctx, 'timeline-toggle');
            }
        }, view.showAllStays ? 'Show fewer stays' : `Show all ${stays.length} stays`) : null
    );
}

// ---------------------------------------------------------------- tab

// The ledger's privacy statement (ADR 0017): what is stored, at what precision, and where the
// counting happens.
function privacyNote() {
    return h('details', { class: 'small', id: 'ledger-privacy' },
        h('summary', {}, 'How your ledger data is kept'),
        h('p', {}, 'Places are saved as a town or a country with the map\'s coordinates for it, never your precise location. A place found through the world search is rounded to about a kilometer; only coordinates you import yourself are kept as they are in the file.'),
        h('p', {}, 'Days, rules, thresholds and alerts are counted on this device. Evidence reports are made here only when you ask, and are never sent to the server or stored there.'),
        h('p', {}, 'The server keeps your visits, your ledger settings and the history of visit dates, so reports can show every change. None of it is ever on your public map, and deleting your account deletes all of it.')
    );
}

export function renderLedger(container, ctx) {
    const overview = ctx.currentLedger();
    const counted = overview.ledger.countries.size;
    const history = h('div', {}, historySection(ctx));

    fill(container,
        h('div', { class: 'section-head' },
            h('h2', {}, 'Day ledger'),
            h('p', { class: 'muted small' }, counted ? `${counted} ${counted === 1 ? 'country' : 'countries'}` : 'No dated visits yet')
        ),
        h('p', { class: 'muted small' }, 'Every dated visit turns into days in a country; a city counts for its country. Add visits from any place card.'),
        h('p', { class: 'muted small', id: 'ledger-advice' }, ADVICE_NOTE),
        privacyNote(),
        alertsSection(overview),
        dataNotes(overview),
        schengenSection(ctx, overview),
        plansSection(ctx, overview),
        staysSection(ctx, overview),
        thresholdsSection(ctx, overview),
        countersSection(ctx, overview),
        timelineSection(ctx, overview),
        reportSection(ctx, overview),
        history,
        dayRuleSection(ctx)
    );

    // The history arrives a moment later and fills in its own section only.
    if (!ctx.state.ledger.changes) {
        ctx.loadVisitChanges()
            .then(() => fill(history, historySection(ctx)))
            .catch(() => fill(history, h('p', { class: 'muted small' }, 'The date history could not be loaded.')));
    }
}

// Redraws the tab after a view change and keeps focus on the control that made it.
function rerender(ctx, focusId) {
    ctx.selectTab('ledger');
    document.getElementById(focusId)?.focus();
}
