'use strict';

// Shared trip expenses: an editor on a trip planned together says who paid, and the owner sees it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('who paid each expense is saved with the trip, for everyone on it', async () => {
    const owner = createClient(ctx.server);
    await owner.register('split_owner', 'split owner password');
    const editor = createClient(ctx.server);
    await editor.register('split_editor', 'split editor password');
    const budget = { currency: 'EUR', planned: null, rates: {}, expenses: [{ label: 'Hotel', amount: 300, currency: 'EUR', category: 'stay' }] };
    const trip = { title: 'Lisbon together', destination: 'Lisbon', plan: [{}, {}], budget };
    const { body: created } = await owner.post('/api/trips', trip);
    await owner.put(`/api/trips/${created.id}/members/split_editor`, { role: 'edit' });

    const paid = { ...budget, expenses: [{ ...budget.expenses[0], paidBy: 'split_editor' }, { label: 'Dinner', amount: 60, currency: 'EUR', category: 'food', paidBy: 'split_owner' }] };
    const saved = await editor.put(`/api/trips/${created.id}`, { ...trip, budget: paid });
    assert.equal(saved.status, 200);
    const seen = (await owner.get('/api/trips')).body.find(item => item.id === created.id);
    assert.deepEqual(seen.budget.expenses.map(expense => expense.paidBy), ['split_editor', 'split_owner']);
    assert.equal((await editor.put(`/api/trips/${created.id}`, { ...trip, budget: { ...budget, expenses: [{ ...budget.expenses[0], paidBy: '!' }] } })).status, 400);
});
