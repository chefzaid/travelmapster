// An organization's pre-trip checklist (ADR 0030) in its manage dialog: admins add, edit and
// remove tasks for business trips to some countries; managers read them.
import { h, toast, formDialog } from './ui.js';
import { checkChecklistItem } from './org-data.js';
import { newId, parseCountryList } from './ledger-rules.js';
import { countryName } from './ledger-report.js';
import { formatList, joinList, t, tn } from './i18n.js';

const MAX_ITEMS = 50;

async function itemDialog(ctx, item) {
    let draft = item ? { ...item, countries: joinList(item.countries.map(id => countryName(ctx, id))), link: item.link || '' }
        : { task: '', countries: '', daysBefore: 14, link: '' };
    for (;;) {
        const values = await formDialog({
            title: item ? t('Edit {task}', { task: item.task }) : t('Add a task before trips'),
            message: t('Travelers see it on their business trips to these countries, and add it to their packing list.'),
            submitLabel: item ? t('Save task') : t('Add task'),
            fields: [
                { name: 'task', label: t('Task'), value: draft.task, required: true, maxlength: 80, placeholder: t('A1 certificate') },
                { name: 'countries', label: t('For trips to'), value: draft.countries, required: true, hint: t('Countries separated by commas. “Schengen” adds every Schengen country.') },
                { name: 'daysBefore', label: t('Due days before the trip'), type: 'number', value: draft.daysBefore, min: 0, max: 365 },
                { name: 'link', label: t('Link to the official page'), type: 'url', value: draft.link, placeholder: 'https://…' }
            ]
        });
        if (!values) return null;
        const { ids, unknown } = parseCountryList(values.countries, name => ctx.state.index.findByName(name) || ctx.state.index.byId.get(name.toUpperCase()));
        const { item: checked, error } = unknown.length
            ? { error: tn(unknown.length, 'Unknown country: {names}.', 'Unknown countries: {names}.', { names: formatList(unknown) }) }
            : checkChecklistItem({ ...values, id: item?.id || newId() }, ids);
        if (!error) return checked;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

/** The checklist section of the manage dialog; `step` runs a change and redraws the dialog. */
export function checklistSection(ctx, org, step) {
    const admin = org.role === 'admin';
    const checklist = org.checklist || [];
    const save = items => ctx.api.saveOrgChecklist(org.id, items);
    const edit = item => step(async () => {
        const checked = await itemDialog(ctx, item);
        if (!checked) return;
        await save(item ? checklist.map(entry => (entry.id === item.id ? checked : entry)) : [...checklist, checked]);
        toast(t('Saved {task}.', { task: checked.task }), { tone: 'success' });
    });
    const remove = item => step(async () => {
        await save(checklist.filter(entry => entry.id !== item.id));
        toast(t('Removed {task}.', { task: item.task }));
    });
    return h('section', { class: 'dialog-section', 'aria-labelledby': 'org-checklist-title' },
        h('h4', { id: 'org-checklist-title' }, t('🧳 Before a trip')),
        h('p', { class: 'small' }, t('What travelers should do before a business trip, such as an A1 certificate or a posted-worker declaration within the EU.')),
        checklist.length ? h('ul', { class: 'dialog-list' }, checklist.map(item => h('li', { class: 'dialog-item' },
            h('span', {}, h('strong', {}, item.task),
                h('small', {}, tn(item.daysBefore, '{count} day before · {countries}', '{count} days before · {countries}', { countries: joinList(item.countries.map(id => countryName(ctx, id))) }))),
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Edit {task}', { task: item.task }), title: t('Edit'), onclick: () => edit(item) }, '✏️') : null,
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove {task}', { task: item.task }), title: t('Remove'), onclick: () => remove(item) }, '🗑️') : null
        ))) : h('p', { class: 'muted small' }, t('Nothing to do before trips yet.')),
        admin && checklist.length < MAX_ITEMS ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => edit(null) }, t('＋ Task before trips')) : null);
}
