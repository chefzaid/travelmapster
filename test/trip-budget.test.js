// Unit tests for trip packing lists and budgets (public/js/trip-budget.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'trip-budget.js'));

const budget = {
    currency: 'EUR',
    planned: 1000,
    rates: { JPY: 0.006, USD: 0.9 },
    expenses: [
        { label: 'Flights', amount: 600, currency: 'EUR', category: 'transport' },
        { label: 'Ryokan', amount: 30000, currency: 'JPY', category: 'stay' },
        { label: 'Sushi', amount: 5000, currency: 'JPY', category: 'food' },
        { label: 'Museum', amount: 20, currency: 'GBP', category: 'activities' }
    ]
};

test('budget totals convert with the traveler\'s rates and list currencies without one', async () => {
    const { budgetTotals, foreignCurrencies } = await load();
    const totals = budgetTotals(budget);
    assert.equal(Math.round(totals.total * 100) / 100, 810);
    assert.equal(totals.byCategory.stay, 180);
    assert.equal(totals.byCategory.food, 30);
    assert.equal(totals.byCategory.activities, 0);
    assert.deepEqual(totals.missing, ['GBP']);
    assert.equal(Math.round(totals.left), 190);
    assert.equal(budgetTotals({ ...budget, planned: null }).left, null);
    assert.equal(budgetTotals({ ...budget, planned: 100 }).left < 0, true);
    assert.deepEqual(budgetTotals({ currency: 'EUR' }), {
        total: 0, byCategory: { transport: 0, stay: 0, food: 0, activities: 0, other: 0 }, missing: [], left: null
    });
    assert.deepEqual(foreignCurrencies(budget), ['GBP', 'JPY']);
    assert.deepEqual(foreignCurrencies({ currency: 'EUR' }), []);
});

test('budgets are tidied, started and given a home currency', async () => {
    const { tidyBudget, emptyBudget, homeCurrency } = await load();
    assert.deepEqual(tidyBudget(budget).rates, { JPY: 0.006 }, 'rates for currencies no longer used go');
    assert.deepEqual(tidyBudget({}), {});
    assert.deepEqual(tidyBudget(undefined), {});
    assert.deepEqual(emptyBudget('JPY'), { currency: 'JPY', planned: null, rates: {}, expenses: [] });
    assert.equal(homeCurrency([{ budget: {} }, { budget: { currency: 'CHF' } }]), 'CHF');
    assert.equal(homeCurrency([{}]), 'EUR');
    assert.equal(homeCurrency(), 'EUR');
});

test('packing lists count what is packed and add items once each', async () => {
    const { packingProgress, withItems, STARTER_PACKING, PACKING_MAX_ITEMS } = await load();
    assert.deepEqual(packingProgress([{ item: 'A', packed: true }, { item: 'B', packed: false }]), { packed: 1, total: 2 });
    assert.deepEqual(packingProgress(), { packed: 0, total: 0 });
    const list = withItems([{ item: 'phone charger', packed: true }], STARTER_PACKING);
    assert.equal(list.length, STARTER_PACKING.length);
    assert.deepEqual(list[0], { item: 'phone charger', packed: true });
    assert.ok(list.slice(1).every(entry => !entry.packed));
    assert.deepEqual(withItems(list, STARTER_PACKING), list);
    assert.deepEqual(withItems([], ['Hat', 'hat', 'Socks']).map(entry => entry.item), ['Hat', 'Socks']);
    assert.equal(withItems(Array.from({ length: PACKING_MAX_ITEMS }, (_, i) => ({ item: `x${i}`, packed: false })), STARTER_PACKING).length, PACKING_MAX_ITEMS);
    assert.equal(withItems(undefined, STARTER_PACKING).length, STARTER_PACKING.length);
    assert.deepEqual(withItems(), []);
});

test('money and currency names come from Intl', async () => {
    const { formatMoney, currencyOptions } = await load();
    assert.equal(formatMoney(1234.5, 'EUR', 'en-GB'), '€1,234.50');
    assert.equal(formatMoney(1200, 'JPY', 'en-US'), '¥1,200');
    assert.equal(formatMoney(5, 'X1', 'en'), '5.00 X1');
    const options = currencyOptions('en');
    assert.ok(options.some(option => option.value === 'EUR' && option.label === 'EUR · Euro'));
    assert.ok(currencyOptions().length > 100);
});
