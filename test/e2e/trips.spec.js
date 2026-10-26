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
