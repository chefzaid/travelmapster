// Small DOM helpers: safe element builder, toasts, and dialogs.

export function h(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') element.className = value;
        else if (key === 'dataset') Object.assign(element.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
        else if (value === true) element.setAttribute(key, '');
        else element.setAttribute(key, value);
    }
    for (const child of children.flat()) {
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

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise(resolve => {
        const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'confirm-title' },
            h('form', { method: 'dialog', class: 'dialog-body' },
                h('h3', { id: 'confirm-title' }, title),
                h('p', {}, message),
                h('div', { class: 'dialog-actions' },
                    h('button', { class: 'btn btn-ghost', value: 'cancel' }, 'Cancel'),
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

// Opens a modal containing a form; resolves with FormData values or null when cancelled.
export function formDialog({ title, fields, submitLabel = 'Save' }) {
    return new Promise(resolve => {
        const form = h('form', { method: 'dialog', class: 'dialog-body' }, h('h3', {}, title));
        for (const field of fields) {
            const id = `dialog-${field.name}`;
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
                    maxlength: field.maxlength
                });
            }
            form.append(h('label', { class: 'field', for: id }, h('span', {}, field.label), control, field.hint ? h('small', {}, field.hint) : null));
        }
        form.append(h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Cancel'),
            h('button', { class: 'btn btn-primary', value: 'save' }, submitLabel)
        ));
        const dialog = h('dialog', { class: 'dialog' }, form);
        dialog.addEventListener('close', () => {
            const values = dialog.returnValue === 'save' ? Object.fromEntries(new FormData(form)) : null;
            resolve(values);
            dialog.remove();
        });
        document.body.append(dialog);
        dialog.showModal();
    });
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
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// replaceChildren, skipping the null/false placeholders used for optional sections.
export function fill(container, ...children) {
    container.replaceChildren(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
    return container;
}
