// Ledger tab: choosing a ready-made rule (rule-templates.js) to start the rule dialog from, with
// what each one is and its official source.
import { h, formDialog } from './ui.js';
import { templatesOf } from './rule-templates.js';
import { adviceNote } from './ledger-report.js';
import { t } from './i18n.js';

/** Asks which template of a kind of rule to start from; resolves to it, or null. */
export async function pickTemplate(kind) {
    const templates = templatesOf(kind);
    const values = await formDialog({
        title: t('Start from a template'),
        message: adviceNote(),
        content: h('ul', { class: 'template-list' }, templates.map(template => h('li', {},
            h('strong', {}, template.name),
            template.note ? h('small', {}, ` ${template.note}`) : null, ' ',
            h('a', { href: template.source, target: '_blank', rel: 'noopener noreferrer' }, t('Source ↗'))))),
        submitLabel: t('Use it'),
        fields: [{ name: 'template', label: t('Template'), type: 'select', value: templates[0]?.id,
            options: templates.map(template => ({ value: template.id, label: template.name })) }]
    });
    return values ? templates.find(template => template.id === values.template) || null : null;
}
