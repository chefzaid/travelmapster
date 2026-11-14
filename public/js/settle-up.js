// Shared trip expenses: on a trip planned together, each expense names who paid it, and the
// costs are split evenly between everyone on the trip. Settling up takes the fewest payments a
// simple greedy match finds, in the budget's currency. Pure, unit tested in Node.
const CENT = 0.005;

const round = amount => Math.round(amount * 100) / 100;

/**
 * Who paid what and who owes whom, for `people` (usernames) and the expenses with a `paidBy`:
 * `balances` `{ name, paid, share, balance }` (positive is owed money), `transfers`
 * `{ from, to, amount }`, the `total` split, and the currencies `missing` a rate. A payer who has
 * left the trip still counts; expenses nobody paid are not split.
 */
export function settleUp(budget, people) {
    const names = [...new Set(people)];
    const paid = new Map(names.map(name => [name, 0]));
    const missing = new Set();
    let total = 0;
    for (const expense of budget.expenses || []) {
        if (!expense.paidBy) continue;
        const rate = expense.currency === budget.currency ? 1 : budget.rates?.[expense.currency];
        if (!rate) {
            missing.add(expense.currency);
            continue;
        }
        const value = expense.amount * rate;
        paid.set(expense.paidBy, (paid.get(expense.paidBy) || 0) + value);
        total += value;
    }
    const share = paid.size ? total / paid.size : 0;
    const balances = [...paid].map(([name, amount]) => ({ name, paid: round(amount), share: round(share), balance: round(amount - share) }));
    const creditors = balances.filter(item => item.balance > CENT).map(item => ({ ...item })).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    const debtors = balances.filter(item => item.balance < -CENT).map(item => ({ ...item, balance: -item.balance })).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    const transfers = [];
    while (creditors.length && debtors.length) {
        const [creditor] = creditors;
        const [debtor] = debtors;
        const amount = round(Math.min(creditor.balance, debtor.balance));
        if (amount > CENT) transfers.push({ from: debtor.name, to: creditor.name, amount });
        creditor.balance -= amount;
        debtor.balance -= amount;
        if (creditor.balance <= CENT) creditors.shift();
        if (debtor.balance <= CENT) debtors.shift();
    }
    return { total: round(total), balances, transfers, missing: [...missing].sort() };
}
