// The trip editor's "Split costs", on a trip planned together: who paid each expense of the
// budget, and who owes whom once the costs are split evenly between everyone on the trip
// (settle-up.js). Who paid is saved with the trip, like the rest of the budget.
import { h, fill } from './ui.js';
import { section } from './trip-extras.js';
import { formatMoney } from './trip-budget.js';
import { settleUp } from './settle-up.js';
import { formatList, t } from './i18n.js';

function settlement(budget, people) {
    const { balances, transfers, missing } = settleUp(budget, people);
    const money = amount => formatMoney(amount, budget.currency);
    return h('div', { class: 'split-totals', 'aria-live': 'polite' },
        transfers.length
            ? h('ul', { class: 'split-transfers' }, transfers.map(({ from, to, amount }) =>
                h('li', {}, h('strong', {}, t('{from} pays {to} {amount}', { from, to, amount: money(amount) })))))
            : h('p', {}, h('strong', {}, t('All square.'))),
        h('ul', { class: 'split-balances' }, balances.map(({ name, paid, share }) =>
            h('li', {}, t('{name}: paid {paid}, share {share}', { name, paid: money(paid), share: money(share) })))),
        missing.length ? h('p', { class: 'hint' }, t('Add a rate for {currencies} to count those expenses.', { currencies: formatList(missing) })) : null);
}

function draw(body, draft, people, markDirty) {
    const { budget } = draft;
    if (people.length < 2) {
        fill(body, h('p', { class: 'hint' }, t('Share this trip with the people you travel with to split its costs.')));
        return;
    }
    const totals = h('div');
    const redraw = () => fill(totals, settlement(budget, people));
    const payers = [...new Set([...people, ...budget.expenses.map(expense => expense.paidBy).filter(Boolean)])];
    fill(body,
        h('p', { class: 'hint' }, t('Say who paid each expense; the costs are split evenly between everyone on the trip.')),
        budget.expenses.length ? h('ul', { class: 'split-list' }, budget.expenses.map(expense => h('li', {},
            h('span', {}, `${expense.label} · ${formatMoney(expense.amount, expense.currency)}`),
            h('select', {
                'aria-label': t('Who paid {expense}', { expense: expense.label }),
                onchange: event => {
                    if (event.target.value) expense.paidBy = event.target.value;
                    else delete expense.paidBy;
                    markDirty();
                    redraw();
                }
            },
                h('option', { value: '', selected: !expense.paidBy }, t('Not split')),
                payers.map(name => h('option', { value: name, selected: expense.paidBy === name }, name)))))) : h('p', { class: 'hint' }, t('No expenses yet.')),
        totals);
    redraw();
}

/** The section of a saved trip with a budget; it asks who is on the trip when first opened. */
export function splitSection(ctx, trip, draft, { markDirty }) {
    if (!trip.id || !draft.budget?.currency || ctx.state.user?.guest) return null;
    const body = h('div', {}, h('p', { class: 'hint' }, t('Loading…')));
    let loaded = false;
    const load = () => {
        if (loaded) return;
        loaded = true;
        ctx.api.getTripMembers(trip.id)
            .then(members => draw(body, draft, [trip.owner || ctx.state.user.username, ...members.map(member => member.username)], markDirty))
            .catch(() => fill(body, h('p', { class: 'hint' }, t('Who is on the trip could not be loaded.'))));
    };
    const details = section('split', t('🤝 Split costs'), h('small', {}), body);
    details.addEventListener('toggle', () => { if (details.open) load(); });
    if (details.open) load();
    return details;
}
