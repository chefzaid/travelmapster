// Ledger tab, "Days that do not count": periods under a residence permit or long-stay visa,
// whose days in the countries they cover are left out of the stay rules (days.js stayDays),
// as the Schengen calculator page explains. Thresholds such as tax residency still count them.
import { h, toast, formDialog, formatDate } from './ui.js';
import { checkExemption, newId, parseCountryList } from './ledger-rules.js';
import { countryLabel } from './ledger-parts.js';
import { countryName } from './ledger-report.js';
import { formatList, joinList, t, tn } from './i18n.js';

async function save(ctx, exempt) {
    try {
        await ctx.saveLedger({ ...ctx.state.ledger.settings, exempt });
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}

async function periodDialog(ctx, period) {
    let draft = period ? { ...period, countries: joinList(period.countries.map(id => countryName(ctx, id))) } : { label: '', countries: '', startDate: '', endDate: '' };
    for (;;) {
        const values = await formDialog({
            title: period ? t('Edit {name}', { name: period.label }) : t('Add a period that does not count'),
            message: t('While a residence permit or long-stay visa covers a country, your days there do not count toward its stay rules. Tax thresholds still count them.'),
            submitLabel: period ? t('Save period') : t('Add period'),
            fields: [
                { name: 'label', label: t('Permit or visa'), value: draft.label, required: true, maxlength: 80, placeholder: t('French residence permit') },
                { name: 'countries', label: t('Countries'), value: draft.countries, required: true, hint: t('The countries it lets you live in, separated by commas.') },
                { name: 'startDate', label: t('First day'), type: 'date', value: draft.startDate, required: true },
                { name: 'endDate', label: t('Last day'), type: 'date', value: draft.endDate, required: true }
            ]
        });
        if (!values) return null;
        const { ids, unknown } = parseCountryList(values.countries, name => ctx.state.index.findByName(name) || ctx.state.index.byId.get(name.toUpperCase()));
        const { period: checked, error } = unknown.length
            ? { error: tn(unknown.length, 'Unknown country: {names}.', 'Unknown countries: {names}.', { names: formatList(unknown) }) }
            : checkExemption({ ...values, id: period?.id || newId() }, ids);
        if (!error) return checked;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

function periodItem(ctx, period) {
    const { exempt } = ctx.state.ledger.settings;
    const edit = async () => {
        const updated = await periodDialog(ctx, period);
        if (updated && await save(ctx, exempt.map(item => (item.id === period.id ? updated : item)))) toast(t('Period saved.'), { tone: 'success' });
    };
    const remove = async () => {
        if (await save(ctx, exempt.filter(item => item.id !== period.id))) {
            toast(t('Removed {name}.', { name: period.label }), { action: { label: t('Undo'), run: () => save(ctx, [...ctx.state.ledger.settings.exempt, period]) } });
        }
    };
    return h('li', { class: 'ledger-item' },
        h('span', { class: 'ledger-item-text' },
            h('strong', {}, period.label),
            h('small', {}, `${formatList(period.countries.map(id => countryLabel(ctx, id)))} · ${formatDate(period.startDate)} – ${formatDate(period.endDate)}`)),
        h('span', { class: 'ledger-item-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Edit {name}', { name: period.label }), title: t('Edit'), onclick: edit }, '✏️'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove {name}', { name: period.label }), title: t('Remove'), onclick: remove }, '🗑️')));
}

export function exemptSection(ctx) {
    const exempt = ctx.state.ledger.settings.exempt || [];
    const add = async () => {
        const period = await periodDialog(ctx);
        if (period && await save(ctx, [...exempt, period])) toast(t('Added {name}.', { name: period.label }), { tone: 'success' });
    };
    return h('section', { 'aria-labelledby': 'exempt-title' },
        h('h3', { class: 'section-title', id: 'exempt-title' }, t('🪪 Days that do not count'), h('span', { class: 'count' }, exempt.length)),
        exempt.length
            ? h('ul', { class: 'ledger-list', id: 'exempt-list' }, exempt.map(period => periodItem(ctx, period)))
            : h('p', { class: 'muted small' }, t('Living somewhere on a residence permit or long-stay visa? Add it, and your days there stop counting toward its stay rules.')),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: add }, t('＋ Add a period')));
}
