// The packing list's templates in the trip editor: start the list from a ready-made or saved
// template, save the list as a template of your own, or remove one. Templates are saved on the
// account at once; the trip's list itself is saved with the trip.
import { h, toast, formDialog } from './ui.js';
import { TEMPLATE_NAME_MAX, packingTemplates, templateFrom, withTemplate, withoutTemplate } from './packing-templates.js';
import { withItems } from './trip-budget.js';
import { t, tn } from './i18n.js';

let chosenKey = 'basics';

async function saveTemplates(ctx, templates, message) {
    try {
        const profile = await ctx.api.saveProfile({ packingTemplates: templates });
        ctx.state.user.packingTemplates = profile.packingTemplates;
        toast(message, { tone: 'success' });
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}

async function saveAsTemplate(ctx, draft, rerender) {
    const values = await formDialog({
        title: t('Save as a template'),
        message: t('Start the packing list of a later trip from this one. Nothing is ticked off in a template.'),
        fields: [{ name: 'name', label: t('Template name'), required: true, maxlength: TEMPLATE_NAME_MAX, placeholder: t('Weekend in the mountains'), autocomplete: 'off' }],
        submitLabel: t('Save template')
    });
    const name = values?.name?.trim();
    if (!name) return;
    const next = withTemplate(ctx.state.user.packingTemplates, templateFrom(name, draft.packing));
    if (!next) {
        toast(t('You can keep up to 20 templates. Remove one first.'), { tone: 'error' });
        return;
    }
    const message = next.replaced ? t('Updated the template {name}.', { name }) : t('Saved the template {name}.', { name });
    if (await saveTemplates(ctx, next.templates, message)) {
        chosenKey = `own:${name}`;
        rerender();
    }
}

/** Starting from, saving and removing packing list templates, under the trip's list. */
export function templateControls(ctx, draft, { rerender }) {
    const templates = packingTemplates(ctx.state.user?.packingTemplates);
    if (!templates.some(template => template.key === chosenKey)) chosenKey = 'basics';
    const chosen = () => templates.find(template => template.key === chosenKey);
    const remove = h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', hidden: !chosen().own,
        onclick: async () => {
            const { name } = chosen();
            if (await saveTemplates(ctx, withoutTemplate(ctx.state.user.packingTemplates, name), t('Removed the template {name}.', { name }))) rerender();
        }
    }, t('🗑️ Remove template'));
    const option = template => h('option', { value: template.key, selected: template.key === chosenKey }, template.name);
    const own = templates.filter(template => template.own);
    return h('div', { class: 'row packing-templates' },
        h('select', {
            'aria-label': t('Packing list template'),
            onchange: event => {
                chosenKey = event.target.value;
                remove.hidden = !chosen().own;
            }
        },
            h('optgroup', { label: t('Ready-made') }, templates.filter(template => !template.own).map(option)),
            own.length ? h('optgroup', { label: t('Yours') }, own.map(option)) : null),
        h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => {
                const before = draft.packing.length;
                draft.packing = withItems(draft.packing, chosen().items);
                const added = draft.packing.length - before;
                toast(added ? tn(added, 'Added {count} item. Save to keep it.', 'Added {count} items. Save to keep them.') : t('Everything in it is already on your list.'));
                rerender();
            }
        }, t('✨ Add these')),
        remove,
        draft.packing.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => saveAsTemplate(ctx, draft, rerender) }, t('📋 Save as template')) : null);
}
