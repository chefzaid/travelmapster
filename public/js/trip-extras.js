// The trip editor's packing list and budget, edited in the trip's draft and saved with it.
import { h, toast } from './ui.js';
import {
    EXPENSE_CATEGORIES, EXPENSES_MAX, PACKING_MAX_ITEMS, budgetTotals, currencyOptions, emptyBudget,
    foreignCurrencies, formatMoney, homeCurrency, packingProgress, withStarterItems
} from './trip-budget.js';

const CURRENCY_LIST_ID = 'currency-codes';
// Sections the traveler opened stay open when the editor redraws.
const openSections = new Set();

function section(id, title, summary, ...body) {
    return h('details', {
        class: 'trip-extra',
        open: openSections.has(id),
        ontoggle: event => {
            if (event.currentTarget.open) openSections.add(id);
            else openSections.delete(id);
        }
    },
        h('summary', {}, h('span', {}, title), summary),
        ...body
    );
}

// One list of currency codes for every currency field, rather than a long select per expense.
// It lives outside the editor, which redraws.
function ensureCurrencyList() {
    if (document.getElementById(CURRENCY_LIST_ID)) return;
    document.body.append(h('datalist', { id: CURRENCY_LIST_ID },
        currencyOptions(navigator.language).map(option => h('option', { value: option.value, label: option.label }))));
}

function currencyInput(value, label, onvalid) {
    return h('input', {
        value, list: CURRENCY_LIST_ID, maxlength: 3, size: 4, autocomplete: 'off', 'aria-label': label,
        class: 'currency-input',
        onchange: event => {
            const code = event.target.value.trim().toUpperCase();
            if (/^[A-Z]{3}$/.test(code)) onvalid(code);
            else {
                toast('Use a three-letter currency code, such as EUR or JPY.', { tone: 'error' });
                event.target.value = value;
            }
        }
    });
}

// A number from 0 to the given maximum, or null for an empty field; undefined when invalid.
function readAmount(input) {
    if (input.value.trim() === '') return null;
    const amount = Number(input.value);
    return Number.isFinite(amount) && amount >= 0 && amount <= 1e9 ? amount : undefined;
}

// ---------------------------------------------------------------- packing list

/** The packing list section: tick items off, add your own or the basics, remove them. */
export function packingSection(draft, { rerender, markDirty }) {
    const { packed, total } = packingProgress(draft.packing);
    const summary = h('small', {}, total ? `${packed} of ${total} packed` : '');
    const add = event => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('entry');
        const item = input.value.trim();
        if (!item) return;
        if (draft.packing.length >= PACKING_MAX_ITEMS) {
            toast(`A packing list holds at most ${PACKING_MAX_ITEMS} items.`, { tone: 'error' });
            return;
        }
        draft.packing.push({ item, packed: false });
        openSections.add('packing');
        rerender();
    };
    const items = draft.packing.map((entry, i) => h('li', {},
        h('label', { class: 'check' },
            h('input', {
                type: 'checkbox',
                checked: entry.packed,
                onchange: event => {
                    entry.packed = event.target.checked;
                    const progress = packingProgress(draft.packing);
                    summary.textContent = `${progress.packed} of ${progress.total} packed`;
                    markDirty();
                }
            }),
            h('span', {}, entry.item)),
        h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `Remove ${entry.item}`, title: 'Remove',
            onclick: () => {
                draft.packing.splice(i, 1);
                rerender();
            }
        }, '✕')
    ));
    return section('packing', '🎒 Packing list', summary,
        items.length ? h('ul', { class: 'packing-list' }, items) : h('p', { class: 'hint' }, 'Nothing on the list yet.'),
        h('form', { class: 'row extra-add', onsubmit: add },
            h('input', { name: 'entry', maxlength: 80, placeholder: 'Sunscreen, snorkel…', 'aria-label': 'Item to pack', autocomplete: 'off' }),
            h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, '＋ Add')),
        h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: () => {
                const before = draft.packing.length;
                draft.packing = withStarterItems(draft.packing);
                toast(draft.packing.length > before ? 'Added the basics. Save to keep them.' : 'The basics are already on your list.');
                rerender();
            }
        }, '✨ Add the basics')
    );
}

// ---------------------------------------------------------------- budget

function expenseRow(draft, expense, i, rerender, markDirty) {
    return h('li', { class: 'expense' },
        h('input', {
            value: expense.label, maxlength: 80, 'aria-label': 'Expense', class: 'expense-label',
            oninput: event => {
                const label = event.target.value.trim();
                if (label) expense.label = label;
                markDirty();
            },
            onchange: event => { event.target.value = expense.label; }
        }),
        h('select', {
            'aria-label': `Category of ${expense.label}`, class: 'expense-category',
            onchange: event => {
                expense.category = event.target.value;
                rerender();
            }
        }, EXPENSE_CATEGORIES.map(([id, icon, label]) => h('option', { value: id, selected: id === expense.category }, `${icon} ${label}`))),
        h('input', {
            type: 'number', min: 0, step: 'any', value: expense.amount, 'aria-label': `Amount of ${expense.label}`, class: 'expense-amount',
            onchange: event => {
                const amount = readAmount(event.target);
                if (amount === undefined || amount === null) event.target.value = expense.amount;
                else expense.amount = amount;
                rerender();
            }
        }),
        currencyInput(expense.currency, `Currency of ${expense.label}`, code => {
            expense.currency = code;
            rerender();
        }),
        h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `Remove ${expense.label}`, title: 'Remove',
            onclick: () => {
                draft.budget.expenses.splice(i, 1);
                rerender();
            }
        }, '✕')
    );
}

function rateRow(budget, code, rerender) {
    return h('label', { class: 'rate' },
        h('span', {}, `1 ${code} =`),
        h('input', {
            type: 'number', min: 0, step: 'any', value: budget.rates[code] ?? '', placeholder: 'rate',
            'aria-label': `${budget.currency} for 1 ${code}`,
            onchange: event => {
                const rate = readAmount(event.target);
                if (rate) budget.rates[code] = rate;
                else delete budget.rates[code];
                rerender();
            }
        }),
        h('span', {}, budget.currency)
    );
}

function addExpenseForm(draft, rerender) {
    const { budget } = draft;
    const lastCurrency = budget.expenses.at(-1)?.currency || budget.currency;
    return h('form', {
        class: 'extra-add expense-add',
        onsubmit: event => {
            event.preventDefault();
            const form = event.currentTarget.elements;
            const label = form.label.value.trim();
            const amount = readAmount(form.amount);
            const currency = form.currency.value.trim().toUpperCase();
            if (!label || amount === undefined || amount === null || !/^[A-Z]{3}$/.test(currency)) {
                toast('Name the expense, and give its amount and a three-letter currency code.', { tone: 'error' });
                return;
            }
            if (budget.expenses.length >= EXPENSES_MAX) {
                toast(`A budget holds at most ${EXPENSES_MAX} expenses.`, { tone: 'error' });
                return;
            }
            budget.expenses.push({ label, amount, currency, category: form.category.value });
            rerender();
        }
    },
        h('input', { name: 'label', maxlength: 80, placeholder: 'Train to Kyoto', 'aria-label': 'New expense', autocomplete: 'off', class: 'expense-label' }),
        h('select', { name: 'category', 'aria-label': 'Category', class: 'expense-category' },
            EXPENSE_CATEGORIES.map(([id, icon, label]) => h('option', { value: id, selected: id === 'other' }, `${icon} ${label}`))),
        h('input', { name: 'amount', type: 'number', min: 0, step: 'any', placeholder: '0.00', 'aria-label': 'Amount', class: 'expense-amount' }),
        h('input', { name: 'currency', value: lastCurrency, list: CURRENCY_LIST_ID, maxlength: 3, size: 4, 'aria-label': 'Currency', class: 'currency-input' }),
        h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, '＋ Add')
    );
}

function totalsView(budget) {
    const { total, byCategory, missing, left } = budgetTotals(budget);
    const money = amount => formatMoney(amount, budget.currency);
    return h('div', { class: 'budget-totals', 'aria-live': 'polite' },
        h('p', {}, h('strong', {}, `Spent: ${money(total)}`),
            left === null ? null : h('span', { class: left < 0 ? 'over' : '' }, left < 0 ? ` · ${money(-left)} over budget` : ` · ${money(left)} left`)),
        h('ul', { class: 'budget-categories' }, EXPENSE_CATEGORIES.filter(([id]) => byCategory[id]).map(([id, icon, label]) =>
            h('li', {}, `${icon} ${label}: ${money(byCategory[id])}`))),
        missing.length ? h('p', { class: 'hint' }, `Add a rate for ${missing.join(', ')} to count those expenses.`) : null
    );
}

/** The budget section: expenses in any currency, totalled in the traveler's home currency. */
export function budgetSection(draft, { rerender, markDirty, trips }) {
    const { budget } = draft;
    ensureCurrencyList();
    if (!budget.currency) {
        let currency = homeCurrency(trips);
        return section('budget', '🧾 Budget', null,
            h('p', { class: 'hint' }, 'Note what the trip costs in any currency and see the total in your home currency.'),
            h('div', { class: 'row extra-add' },
                h('label', { class: 'rate' }, h('span', {}, 'Home currency'), currencyInput(currency, 'Home currency', code => { currency = code; })),
                h('button', {
                    type: 'button', class: 'btn btn-ghost btn-sm',
                    onclick: () => {
                        draft.budget = emptyBudget(currency);
                        openSections.add('budget');
                        rerender();
                    }
                }, 'Start a budget'))
        );
    }
    const { total } = budgetTotals(budget);
    const summary = budget.planned === null ? formatMoney(total, budget.currency)
        : `${formatMoney(total, budget.currency)} of ${formatMoney(budget.planned, budget.currency)}`;
    const foreign = foreignCurrencies(budget);
    return section('budget', '🧾 Budget', h('small', {}, summary),
        h('div', { class: 'row extra-add' },
            h('label', { class: 'rate' }, h('span', {}, 'Home currency'), currencyInput(budget.currency, 'Home currency', code => {
                budget.currency = code;
                rerender();
            })),
            h('label', { class: 'rate' }, h('span', {}, 'Planned'), h('input', {
                type: 'number', min: 0, step: 'any', value: budget.planned ?? '', placeholder: 'optional', 'aria-label': 'Planned budget', class: 'expense-amount',
                onchange: event => {
                    const planned = readAmount(event.target);
                    if (planned !== undefined) budget.planned = planned;
                    rerender();
                }
            }))
        ),
        budget.expenses.length
            ? h('ul', { class: 'expense-list' }, budget.expenses.map((expense, i) => expenseRow(draft, expense, i, rerender, markDirty)))
            : h('p', { class: 'hint' }, 'No expenses yet.'),
        addExpenseForm(draft, rerender),
        foreign.length ? h('fieldset', { class: 'rates' },
            h('legend', {}, 'Exchange rates: the rate you got'),
            foreign.map(code => rateRow(budget, code, rerender))) : null,
        totalsView(budget),
        h('button', {
            type: 'button', class: 'btn btn-danger-ghost btn-sm',
            onclick: () => {
                draft.budget = {};
                rerender();
            }
        }, 'Remove the budget')
    );
}
