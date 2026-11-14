'use strict';

// Shared trip expenses (public/js/settle-up.js): costs split evenly, and who pays whom to settle.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseTripPayload } = require('../src/trip-validation');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'settle-up.js'));
const budget = expenses => ({ currency: 'EUR', rates: { JPY: 0.006 }, expenses });

test('costs are split evenly and the fewest payments settle them', async () => {
    const { settleUp } = await load();
    const result = settleUp(budget([
        { label: 'Hotel', amount: 300, currency: 'EUR', paidBy: 'ana' },
        { label: 'Dinner', amount: 10000, currency: 'JPY', paidBy: 'ben' },
        { label: 'Snacks', amount: 20, currency: 'EUR' }
    ]), ['ana', 'ben', 'cy']);
    assert.equal(result.total, 360);
    assert.deepEqual(result.balances, [
        { name: 'ana', paid: 300, share: 120, balance: 180 },
        { name: 'ben', paid: 60, share: 120, balance: -60 },
        { name: 'cy', paid: 0, share: 120, balance: -120 }
    ]);
    assert.deepEqual(result.transfers, [{ from: 'cy', to: 'ana', amount: 120 }, { from: 'ben', to: 'ana', amount: 60 }]);
    assert.deepEqual(result.missing, []);
});

test('thirds round to the cent, a payer who left still counts, and a missing rate is reported', async () => {
    const { settleUp } = await load();
    const result = settleUp(budget([
        { label: 'Taxi', amount: 10, currency: 'EUR', paidBy: 'ana' },
        { label: 'Museum', amount: 30, currency: 'USD', paidBy: 'ben' },
        { label: 'Ferry', amount: 5, currency: 'EUR', paidBy: 'dee' }
    ]), ['ana', 'ben', 'ana']);
    assert.deepEqual(result.missing, ['USD']);
    assert.deepEqual(result.balances.map(item => item.name), ['ana', 'ben', 'dee']);
    assert.deepEqual(result.transfers, [{ from: 'ben', to: 'ana', amount: 5 }]);
    assert.deepEqual(settleUp(budget([]), ['ana']), { total: 0, balances: [{ name: 'ana', paid: 0, share: 0, balance: 0 }], transfers: [], missing: [] });
    assert.deepEqual(settleUp({ currency: 'EUR' }, []).transfers, []);
    const thirds = settleUp(budget([{ label: 'Boat', amount: 100, currency: 'EUR', paidBy: 'ana' }]), ['ana', 'ben', 'cy']);
    assert.deepEqual(thirds.transfers, [{ from: 'ben', to: 'ana', amount: 33.33 }, { from: 'cy', to: 'ana', amount: 33.33 }]);
});

test('the API keeps who paid an expense when it is a username', () => {
    const trip = expenses => parseTripPayload({ title: 'T', destination: 'D', plan: [{}], budget: { currency: 'EUR', expenses } });
    const expense = { label: 'Hotel', amount: 300, currency: 'EUR', category: 'stay' };
    assert.deepEqual(trip([{ ...expense, paidBy: 'ana' }]).trip.budget.expenses, [{ ...expense, paidBy: 'ana' }]);
    assert.deepEqual(trip([{ ...expense, paidBy: null }]).trip.budget.expenses, [expense]);
    assert.equal(trip([{ ...expense, paidBy: 'a b' }]).error, 'Who paid an expense must be a username.');
    assert.equal(trip([{ ...expense, paidBy: 7 }]).error, 'Who paid an expense must be a username.');
});
