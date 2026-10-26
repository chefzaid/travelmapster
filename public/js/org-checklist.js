// An organization's pre-trip checklist (ADR 0030) in its manage dialog: admins add, edit and
// remove tasks for business trips to some countries; managers read them.
import { h, toast, formDialog } from './ui.js';
import { checkChecklistItem } from './org-data.js';
import { newId, parseCountryList } from './ledger-rules.js';
import { countryName } from './ledger-report.js';

const MAX_ITEMS = 50;

async function itemDialog(ctx, item) {
    let draft = item ? { ...item, countries: item.countries.map(id => countryName(ctx, id)).join(', '), link: item.link || '' }
        : { task: '', countries: '', daysBefore: 14, link: '' };
    for (;;) {
        const values = await formDialog({
            title: item ? `Edit ${item.task}` : 'Add a task before trips',
            message: 'Travelers see it on their business trips to these countries, and add it to their packing list.',
            submitLabel: item ? 'Save task' : 'Add task',
            fields: [
                { name: 'task', label: 'Task', value: draft.task, required: true, maxlength: 80, placeholder: 'A1 certificate' },
                { name: 'countries', label: 'For trips to', value: draft.countries, required: true, hint: 'Countries separated by commas. “Schengen” adds every Schengen country.' },
                { name: 'daysBefore', label: 'Due days before the trip', type: 'number', value: draft.daysBefore, min: 0, max: 365 },
                { name: 'link', label: 'Link to the official page', type: 'url', value: draft.link, placeholder: 'https://…' }
            ]
        });
        if (!values) return null;
        const { ids, unknown } = parseCountryList(values.countries, name => ctx.state.index.findByName(name) || ctx.state.index.byId.get(name.toUpperCase()));
        const { item: checked, error } = unknown.length
            ? { error: `Unknown ${unknown.length === 1 ? 'country' : 'countries'}: ${unknown.join(', ')}.` }
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
        toast(`Saved ${checked.task}.`, { tone: 'success' });
    });
    const remove = item => step(async () => {
        await save(checklist.filter(entry => entry.id !== item.id));
        toast(`Removed ${item.task}.`);
    });
    return h('section', { class: 'dialog-section', 'aria-labelledby': 'org-checklist-title' },
        h('h4', { id: 'org-checklist-title' }, '🧳 Before a trip'),
        h('p', { class: 'small' }, 'What travelers should do before a business trip, such as an A1 certificate or a posted-worker declaration within the EU.'),
        checklist.length ? h('ul', { class: 'dialog-list' }, checklist.map(item => h('li', { class: 'dialog-item' },
            h('span', {}, h('strong', {}, item.task),
                h('small', {}, `${item.daysBefore} ${item.daysBefore === 1 ? 'day' : 'days'} before · ${item.countries.map(id => countryName(ctx, id)).join(', ')}`)),
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${item.task}`, title: 'Edit', onclick: () => edit(item) }, '✏️') : null,
            admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${item.task}`, title: 'Remove', onclick: () => remove(item) }, '🗑️') : null
        ))) : h('p', { class: 'muted small' }, 'Nothing to do before trips yet.'),
        admin && checklist.length < MAX_ITEMS ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => edit(null) }, '＋ Task before trips') : null);
}
