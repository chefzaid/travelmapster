// Small DOM helpers: safe element builder, toasts, and dialogs.
import { locale, t } from './i18n.js';

export function h(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') element.className = value;
        else if (key === 'dataset') Object.assign(element.dataset, value);
        // Set styles through the CSSOM so a strict style-src CSP (no style attributes) still allows them.
        else if (key === 'style') element.style.cssText = value;
        else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
        else if (value === true) element.setAttribute(key, '');
        else element.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) {
        if (child === undefined || child === null || child === false) continue;
        element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
}

export function $(selector, root = document) {
    return root.querySelector(selector);
}

export function $all(selector, root = document) {
    return [...root.querySelectorAll(selector)];
}

/**
 * Shows a short message; returns a function that closes it early.
 * @param {string} message
 * @param {{ tone?: string, action?: { label: string, run: () => void }, duration?: number }} [options]
 */
export function toast(message, { tone = 'info', action, duration = 4000 } = {}) {
    const region = $('#toasts');
    const icons = { info: '💬', success: '🎉', error: '⚠️' };
    const item = h('div', { class: `toast toast-${tone}`, role: tone === 'error' ? 'alert' : 'status' },
        h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icons[tone] || icons.info),
        h('span', { class: 'toast-message' }, message)
    );
    let timer;
    const close = () => {
        clearTimeout(timer);
        item.classList.add('leaving');
        setTimeout(() => item.remove(), 200);
    };
    if (action) {
        item.append(h('button', {
            class: 'toast-action',
            type: 'button',
            onclick: () => {
                close();
                action.run();
            }
        }, action.label));
    }
    region.append(item);
    // Keep the stack short: drop the oldest toasts beyond three.
    [...region.children].slice(0, -3).forEach(stale => stale.remove());
    timer = setTimeout(close, action ? Math.max(duration, 6000) : duration);
    return close;
}

export function confirmDialog({ title, message, confirmLabel = t('Confirm'), danger = false }) {
    return new Promise(resolve => {
        const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'confirm-title' },
            h('form', { method: 'dialog', class: 'dialog-body' },
                h('h3', { id: 'confirm-title' }, title),
                h('p', {}, message),
                h('div', { class: 'dialog-actions' },
                    h('button', { class: 'btn btn-ghost', value: 'cancel' }, t('Cancel')),
                    h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, value: 'confirm' }, confirmLabel)
                )
            )
        );
        dialog.addEventListener('close', () => {
            resolve(dialog.returnValue === 'confirm');
            dialog.remove();
        });
        document.body.append(dialog);
        dialog.showModal();
    });
}

// Several checkboxes drawn as chips in a fieldset; the form returns the checked values.
function choicesField(field) {
    const chosen = new Set(field.value || []);
    return h('fieldset', { class: 'field choices', id: `dialog-${field.name}` },
        h('legend', {}, field.label),
        h('div', { class: 'choice-row' }, field.options.map(option => h('label', { class: 'choice-chip' },
            h('input', { type: 'checkbox', name: field.name, value: option.value, checked: chosen.has(option.value) }),
            h('span', {}, option.label)))),
        field.hint ? h('small', {}, field.hint) : null);
}

// A short text input with one-tap choices that fill it in, such as a pin's emoji.
function pickerField(field, id) {
    const input = h('input', { id, name: field.name, value: field.value ?? '', maxlength: field.maxlength, placeholder: field.placeholder, autocomplete: 'off' });
    const pick = value => () => {
        input.value = value;
        input.focus();
    };
    return h('div', { class: 'field' },
        h('label', { for: id }, field.label),
        input,
        h('div', { class: 'choice-row', role: 'group', 'aria-label': field.choicesLabel },
            field.choices.map(choice => h('button', { type: 'button', class: 'choice-pick', 'aria-label': t('Use {choice}', { choice }), onclick: pick(choice) }, choice)),
            h('button', { type: 'button', class: 'choice-pick choice-clear', onclick: pick('') }, t('None'))),
        field.hint ? h('small', {}, field.hint) : null);
}

/**
 * Opens a modal containing a form; resolves with FormData values or null when cancelled.
 * Fields of type 'choices' resolve to the list of checked values.
 * `content` goes between the message and the fields, such as a picture.
 * @param {{ title: string, message?: string, content?: Node | Node[], fields: Record<string, any>[], submitLabel?: string, danger?: boolean }} options
 * @returns {Promise<Record<string, any> | null>}
 */
export function formDialog({ title, message, content, fields, submitLabel = t('Save'), danger = false }) {
    return new Promise(resolve => {
        const form = h('form', { method: 'dialog', class: 'dialog-body' }, h('h3', {}, title), message ? h('p', {}, message) : null, content);
        for (const field of fields) {
            const id = `dialog-${field.name}`;
            if (field.type === 'choices') {
                form.append(choicesField(field));
                continue;
            }
            if (field.type === 'picker') {
                form.append(pickerField(field, id));
                continue;
            }
            if (field.type === 'checkbox') {
                form.append(h('label', { class: 'field field-check', for: id },
                    h('input', { id, name: field.name, type: 'checkbox', checked: Boolean(field.value) }),
                    h('span', {}, field.label),
                    field.hint ? h('small', {}, field.hint) : null));
                continue;
            }
            let control;
            if (field.type === 'select') {
                control = h('select', { id, name: field.name },
                    field.options.map(option => h('option', { value: option.value, selected: option.value === field.value }, option.label)));
            } else if (field.type === 'textarea') {
                control = h('textarea', { id, name: field.name, maxlength: field.maxlength, rows: 4, placeholder: field.placeholder }, field.value || '');
            } else {
                control = h('input', {
                    id,
                    name: field.name,
                    type: field.type || 'text',
                    value: field.value ?? '',
                    required: field.required,
                    min: field.min,
                    max: field.max,
                    step: field.step,
                    placeholder: field.placeholder,
                    minlength: field.minlength,
                    maxlength: field.maxlength,
                    autocomplete: field.autocomplete,
                    inputmode: field.inputmode,
                    pattern: field.pattern
                });
            }
            form.append(h('label', { class: 'field', for: id }, h('span', {}, field.label), control, field.hint ? h('small', {}, field.hint) : null));
        }
        form.append(h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, t('Cancel')),
            h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, value: 'save' }, submitLabel)
        ));
        const dialog = h('dialog', { class: 'dialog' }, form);
        dialog.addEventListener('close', () => {
            let values = null;
            if (dialog.returnValue === 'save') {
                const data = new FormData(form);
                values = Object.fromEntries(data);
                for (const field of fields.filter(item => item.type === 'choices')) values[field.name] = data.getAll(field.name);
            }
            resolve(values);
            dialog.remove();
        });
        document.body.append(dialog);
        dialog.showModal();
    });
}

/** Returned by a step of a stepped dialog that should not open it again. */
export const STAY_CLOSED = Symbol('stay closed');

/**
 * A dialog drawn by `draw(data, step, close)` from what `load()` answers. `step(action)` closes
 * it, runs the action, whose own dialogs open meanwhile, and opens it again freshly loaded,
 * unless the action returns STAY_CLOSED. Errors go to `onError`, which may return it too.
 */
export async function steppedDialog({ labelledBy, load, draw, onError }) {
    let data;
    try {
        data = await load();
    } catch (error) {
        onError(error);
        return;
    }
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': labelledBy });
    const step = async action => {
        dialog.close();
        let outcome;
        try {
            outcome = await action();
        } catch (error) {
            outcome = await onError(error);
        }
        if (outcome !== STAY_CLOSED) await steppedDialog({ labelledBy, load, draw, onError });
    };
    dialog.append(h('div', { class: 'dialog-body' }, draw(data, step, () => dialog.close())));
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
}

/** Copies text to the clipboard; `fallback` shows instead when the browser does not allow it. */
export async function copyText(text, done, fallback = t('Copying is not available in this browser.')) {
    try {
        await navigator.clipboard.writeText(text);
        toast(done, { tone: 'success' });
    } catch {
        toast(fallback);
    }
}

export function downloadFile(fileName, content, mimeType) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
    const link = h('a', { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function formatDate(value) {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** A moment (an ISO timestamp) with its date and time, in the interface's language. */
export function formatDateTime(value) {
    return value ? new Date(value).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

// replaceChildren, skipping the null/false placeholders used for optional sections.
export function fill(container, ...children) {
    container.replaceChildren(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
    return container;
}
