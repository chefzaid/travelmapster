'use strict';

// Pre-trip checklists (ADR 0030): an admin's task for trips to Germany shows on a business trip
// there, goes onto the packing list and counts down in the trips list until ticked off.
const { test, expect } = require('@playwright/test');
const { browserDay, signUp, stubThirdParties, trackErrors, turnOnTwoStep } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a business trip lists what the organization asks before going', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    const stamp = Date.now();
    const orgName = `Initrode ${stamp}`;
    await signUp(page, `e2e_check_${stamp}`);
    await page.click('#account-btn');
    await page.click('#security-btn');
    await turnOnTwoStep(page);

    // The admin's checklist: an A1 certificate for Germany, due two weeks ahead.
    await page.click('#account-btn');
    await page.click('#orgs-btn');
    await page.getByRole('button', { name: '＋ Create an organization' }).click();
    await page.fill('#dialog-name', orgName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: `Manage ${orgName}` }).click();
    await page.getByRole('button', { name: '＋ Task before trips' }).click();
    await page.fill('#dialog-task', 'A1 certificate');
    await page.fill('#dialog-countries', 'Germany');
    await page.fill('#dialog-daysBefore', '14');
    await page.fill('#dialog-link', 'https://europa.eu/youreurope/');
    await page.getByRole('button', { name: 'Add task' }).click();
    const manage = page.locator('dialog.dialog', { hasText: 'Before a trip' });
    await expect(manage.locator('.dialog-item', { hasText: 'A1 certificate' })).toContainText('14 days before · Germany');
    await manage.getByRole('button', { name: 'Back' }).click();
    await page.locator('dialog.dialog').getByRole('button', { name: 'Done' }).click();

    // A business trip to Berlin in a month.
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Berlin, Germany');
    await page.getByLabel('Trip name').fill('Client workshop');
    await page.getByRole('button', { name: 'Create trip' }).click();
    const trips = page.locator('#trips-tab');
    await trips.getByLabel('Start date').fill(await browserDay(page, 30));
    await trips.getByLabel('Start date').dispatchEvent('change');
    await trips.getByLabel('Trip for').selectOption({ label: `Business: ${orgName}` });
    const checklist = trips.locator('details.trip-extra', { hasText: 'Before you go' });
    await checklist.locator('summary').click();
    await expect(checklist).toContainText('A1 certificate');
    await expect(checklist).toContainText('Not on your list yet · due');
    await expect(checklist.getByRole('link', { name: /About A1 certificate/ })).toHaveAttribute('href', 'https://europa.eu/youreurope/');
    await checklist.getByRole('button', { name: '＋ Add to packing list' }).click();
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' })).toBeVisible();

    await trips.getByRole('button', { name: '‹ All trips' }).click();
    await expect(trips.locator('.trip-card', { hasText: 'Client workshop' })).toContainText('📋 1 to do before you go');

    // Ticked off on the packing list, it is done.
    await trips.locator('.trip-card', { hasText: 'Client workshop' }).click();
    const packing = trips.locator('details.trip-extra').filter({ has: page.locator('summary', { hasText: '🎒 Packing list' }) });
    if (!(await packing.getAttribute('open'))) await packing.locator('summary').click();
    await packing.getByRole('checkbox', { name: 'A1 certificate' }).check();
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' }).last()).toBeVisible();
    await expect(trips.locator('details.trip-extra', { hasText: 'Before you go' })).toContainText('1 of 1 done');
    await trips.getByRole('button', { name: '‹ All trips' }).click();
    await expect(trips.locator('.trip-card', { hasText: 'Client workshop' })).not.toContainText('to do before you go');
    expect(errors).toEqual([]);
});
