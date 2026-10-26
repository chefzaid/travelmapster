// Small pieces the Ledger tab's sections share: a rule's status chip and a days-used meter.
import { h } from './ui.js';
import { t } from './i18n.js';

export function statusChip(status) {
    const labels = { ok: ['chip-ok', t('✓ On track')], warning: ['chip-warn', t('⚠ Getting close')], reached: ['chip-over', t('⛔ Reached')] };
    const [tone, label] = labels[status];
    return h('span', { class: `chip ${tone}` }, label);
}

export function meter(value, max, label) {
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
