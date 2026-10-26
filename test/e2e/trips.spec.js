'use strict';

// Trip planning: itineraries, calendar export, the ledger, recording a trip as a visit, printing.
const { test, expect } = require('@playwright/test');
const { signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a traveler plans a trip that is saved to their account', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_trip_${Date.now()}`);
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Lisbon');
    await page.getByLabel('Trip name').fill('Pastel de nata tour');
    await page.getByLabel('How many days?').fill('2');
    await page.getByRole('button', { name: 'Create trip' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip created: Pastel de nata tour' })).toBeVisible();

    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-trips');
    await expect(page.locator('#trips-tab')).toContainText('Pastel de nata tour');

    // Export to a calendar needs dates; printing and duplicating do not.
    await page.locator('.trip-card', { hasText: 'Pastel de nata tour' }).click();
    const trips = page.locator('#trips-tab');
    await trips.getByRole('button', { name: '📅 Calendar' }).click();
    await expect(page.locator('.toast-error')).toContainText('Choose a start date');
    await trips.getByLabel('Start date').fill('2030-05-01');
    await trips.getByLabel('Start date').dispatchEvent('change');
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' })).toBeVisible();
    const download = page.waitForEvent('download');
    await trips.getByRole('button', { name: '📅 Calendar' }).click();
    expect((await download).suggestedFilename()).toBe('pastel-de-nata-tour.ics');

    // Planned in the ledger, the trip's stay follows its dates.
    await trips.getByRole('button', { name: '📒 Plan in ledger' }).click();
    await expect(trips.getByRole('button', { name: '📒 In ledger plans' })).toHaveAttribute('aria-pressed', 'true');
    await page.click('#tab-ledger');
    await expect(page.locator('#ledger-tab .ledger-item', { hasText: 'Pastel de nata tour' })).toContainText('Portugal');
    await expect(page.locator('#ledger-tab .ledger-item', { hasText: 'Pastel de nata tour' })).toContainText('2 days');
    await page.click('#tab-trips');
    await trips.getByRole('button', { name: '＋ Add a day' }).click();
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' }).last()).toBeVisible();
    await page.click('#tab-ledger');
    await expect(page.locator('#ledger-tab .ledger-item', { hasText: 'Pastel de nata tour' })).toContainText('3 days');
    await page.click('#tab-trips');

    await trips.getByRole('button', { name: '🖨️ Print' }).click();
    const sheet = page.locator('#report-view');
    await expect(sheet.locator('h1')).toHaveText('Pastel de nata tour');
    await expect(sheet.locator('tbody tr')).toHaveCount(3);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    await trips.getByRole('button', { name: '⧉ Duplicate' }).click();
    await expect(trips.getByLabel('Trip name')).toHaveValue('Pastel de nata tour (copy)');
    await expect(trips.getByLabel('Start date')).toHaveValue('');
    await trips.getByRole('button', { name: '‹ All trips' }).click();
    await expect(page.locator('.trip-card')).toHaveCount(2);

    // Deleting the trip takes its stay out of the ledger plans.
    await page.locator('.trip-card', { hasText: 'Pastel de nata tour' }).filter({ hasNotText: 'copy' }).click();
    await trips.getByRole('button', { name: '🗑️ Delete trip' }).click();
    await page.getByRole('button', { name: 'Delete trip' }).last().click();
    await expect(page.locator('.trip-card')).toHaveCount(1);
    await page.click('#tab-ledger');
    await expect(page.locator('#ledger-tab')).not.toContainText('Pastel de nata tour');

    // A trip that has begun is recorded as a visit to its destination, once confirmed.
    await page.click('#tab-trips');
    await page.getByRole('button', { name: '＋ New trip' }).click();
    await page.getByLabel('Where to?').fill('Kyoto');
    await page.getByLabel('Start date').fill('2024-03-01');
    await page.getByLabel('How many days?').fill('2');
    await page.getByRole('button', { name: 'Create trip' }).click();
    await trips.getByRole('button', { name: '✅ Record as a visit' }).click();
    await expect(page.locator('dialog.dialog')).toContainText('Kyoto, Japan: a visit from');
    await page.getByRole('button', { name: 'Add the visit' }).click();
    await expect(trips.getByRole('button', { name: '✓ Recorded as a visit' })).toBeDisabled();
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await page.click('#tab-places');
    await expect(page.locator('#places-tab .place', { hasText: 'Kyoto' })).toContainText('1 visit');
    expect(errors).toEqual([]);
});

test('a trip keeps a packing list and a budget in any currency', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_pack_${Date.now()}`);
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Tokyo');
    await page.getByLabel('How many days?').fill('1');
    await page.getByRole('button', { name: 'Create trip' }).click();
    const trips = page.locator('#trips-tab');

    await trips.getByText('🎒 Packing list').click();
    await trips.getByRole('button', { name: '✨ Add the basics' }).click();
    await trips.getByLabel('Item to pack').fill('Snorkel');
    await trips.getByLabel('Item to pack').press('Enter');
    await trips.getByRole('checkbox', { name: 'Passport or ID' }).check();
    await expect(trips.locator('.trip-extra summary', { hasText: 'Packing list' })).toContainText('1 of 11 packed');

    await trips.getByText('🧾 Budget').click();
    await trips.getByLabel('Home currency').fill('EUR');
    await trips.getByLabel('Home currency').dispatchEvent('change');
    await trips.getByRole('button', { name: 'Start a budget' }).click();
    await trips.getByLabel('Planned budget').fill('1000');
    await trips.getByLabel('Planned budget').dispatchEvent('change');
    const addExpense = async (label, amount, currency) => {
        await trips.getByLabel('New expense').fill(label);
        await trips.getByLabel('Amount', { exact: true }).fill(amount);
        await trips.getByLabel('Currency', { exact: true }).fill(currency);
        await trips.getByLabel('New expense').press('Enter');
    };
    await addExpense('Flights', '600', 'EUR');
    await addExpense('Ryokan', '30000', 'JPY');
    await expect(trips.locator('.budget-totals')).toContainText('Add a rate for JPY');
    await trips.getByLabel('EUR for 1 JPY').fill('0.006');
    await trips.getByLabel('EUR for 1 JPY').dispatchEvent('change');
    await expect(trips.locator('.budget-totals')).toContainText('€780.00');
    await expect(trips.locator('.budget-totals')).toContainText('€220.00 left');

    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' })).toBeVisible();
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-trips');
    await page.locator('.trip-card').first().click();
    await expect(trips.locator('.trip-extra summary', { hasText: 'Packing list' })).toContainText('1 of 11 packed');
    await expect(trips.locator('.trip-extra summary', { hasText: 'Budget' })).toContainText('€780.00 of €1,000.00');

    await trips.getByRole('button', { name: '🖨️ Print' }).click();
    await expect(page.locator('#report-view .report-checklist')).toContainText('☑ Passport or ID');
    await expect(page.locator('#report-view')).toContainText('Spent so far: €780.00');
    expect(errors).toEqual([]);
});
