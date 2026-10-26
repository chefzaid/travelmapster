// A trip's packing list and budget. The budget totals its expenses in its own currency (the
// traveler's home currency) with the exchange rate the traveler enters for each other currency:
// the rate they actually got, with no rate service to depend on. Pure, unit tested in Node.

export const EXPENSE_CATEGORIES = [
    ['transport', '🚆', 'Transport'],
    ['stay', '🛏️', 'Stay'],
    ['food', '🍜', 'Food and drink'],
    ['activities', '🎟️', 'Activities'],
    ['other', '🧾', 'Other']
];

export const STARTER_PACKING = [
    'Passport or ID', 'Tickets and bookings', 'Bank cards and some cash', 'Phone charger',
    'Plug adapter', 'Medicines', 'Toiletries', 'Clothes for each day', 'Comfortable shoes', 'Travel insurance details'
];

export const PACKING_MAX_ITEMS = 200;
export const EXPENSES_MAX = 300;
const FALLBACK_CURRENCIES = ['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'INR', 'JPY', 'MAD', 'MXN', 'USD'];

/** The items packed and the items in all. */
export function packingProgress(packing = []) {
    return { packed: packing.filter(item => item.packed).length, total: packing.length };
}

/** The list with the starter items it does not have yet (compared without case), unpacked. */
export function withStarterItems(packing = []) {
    const known = new Set(packing.map(entry => entry.item.toLowerCase()));
    const added = STARTER_PACKING.filter(item => !known.has(item.toLowerCase())).map(item => ({ item, packed: false }));
    return [...packing, ...added].slice(0, PACKING_MAX_ITEMS);
}

/** The currencies other than the budget's own that its expenses use, sorted. */
export function foreignCurrencies(budget) {
    return [...new Set((budget.expenses || []).map(expense => expense.currency))]
        .filter(code => code !== budget.currency).sort();
}

/**
 * Totals in the budget's currency: all expenses, per category, and what is left of the planned
 * budget. Expenses in a currency without a rate are left out and their currencies listed.
 */
export function budgetTotals(budget) {
    const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map(([id]) => [id, 0]));
    const missing = new Set();
    let total = 0;
    for (const expense of budget.expenses || []) {
        const rate = expense.currency === budget.currency ? 1 : budget.rates?.[expense.currency];
        if (!rate) {
            missing.add(expense.currency);
            continue;
        }
        const value = expense.amount * rate;
        total += value;
        byCategory[expense.category] = (byCategory[expense.category] || 0) + value;
    }
    const planned = typeof budget.planned === 'number' ? budget.planned : null;
    return { total, byCategory, missing: [...missing].sort(), left: planned === null ? null : planned - total };
}

/** An amount with its currency, such as "€1,234.50" or "¥1,200". */
export function formatMoney(amount, currency, locale) {
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

/** Every currency code the browser knows, with its name, for a select. */
export function currencyOptions(locale) {
    let codes = FALLBACK_CURRENCIES;
    let names = null;
    try {
        codes = Intl.supportedValuesOf('currency');
        names = new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'currency' });
    } catch {
        // Older browsers: the common currencies by code only.
    }
    return codes.map(code => ({ value: code, label: names ? `${code} · ${names.of(code)}` : code }));
}

/** The currency of the last budget the traveler set up, else euros: a home currency to start from. */
export function homeCurrency(trips = []) {
    return trips.find(trip => trip.budget?.currency)?.budget.currency || 'EUR';
}

/** A new budget in the given currency. */
export function emptyBudget(currency) {
    return { currency, planned: null, rates: {}, expenses: [] };
}

/** The budget with rates only for currencies it still uses, as the server stores it. */
export function tidyBudget(budget) {
    if (!budget?.currency) return {};
    const used = new Set(foreignCurrencies(budget));
    const rates = Object.fromEntries(Object.entries(budget.rates || {}).filter(([code]) => used.has(code)));
    return { ...budget, rates };
}
