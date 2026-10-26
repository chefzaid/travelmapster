'use strict';

// Friends (ADR 0028): following a public map and comparing countries, and planning a trip
// together with edit and view roles.
const { test, expect } = require('@playwright/test');
const { markCity, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

async function secondTraveler(browser, username) {
    const page = await browser.newPage();
    await stubThirdParties(page);
    await signUp(page, username);
    return page;
}

test('travelers follow each other\'s maps, compare countries, and plan a trip together', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    const stamp = Date.now();
    const ana = `e2e_ana_${stamp}`;
    const ben = `e2e_ben_${stamp}`;
    await signUp(page, ana);
    await markCity(page, 'Lisbon');
    await markCity(page, 'Tokyo');
    await page.keyboard.press('Escape');

    // Ben's public map, followed from its shared page.
    const other = await secondTraveler(browser, ben);
    await markCity(other, 'Tokyo');
    await markCity(other, 'Lima');
    await other.keyboard.press('Escape');
    await other.click('#account-btn');
    await other.locator('label.switch', { hasText: 'Public travel map' }).click();
    await expect(other.locator('#copy-share-btn')).toBeEnabled();
    await other.keyboard.press('Escape');

    await page.goto(`/?u=${ben}`);
    await expect(page.locator('#public-view')).toBeVisible();
    await page.getByRole('button', { name: '＋ Follow this map' }).click();
    await expect(page.getByRole('button', { name: '✓ Following' })).toBeDisabled();

    await page.goto('/');
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-passport');
    const friend = page.locator('.friend', { hasText: ben });
    await expect(friend).toContainText('2 countries · 1 in common');
    await friend.getByRole('button', { name: 'Compare' }).click();
    const comparison = page.locator('dialog.dialog', { hasText: `You and ${ben}` });
    await expect(comparison.locator('section', { hasText: 'Both of you' })).toContainText('Japan');
    await expect(comparison.locator('section', { hasText: 'Only you' })).toContainText('Portugal');
    await expect(comparison.locator('section', { hasText: `Only ${ben}` })).toContainText('Peru');
    await comparison.getByRole('button', { name: 'Close' }).click();

    // A trip shared with Ben to edit.
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Kyoto');
    await page.getByLabel('Trip name').fill('Temples together');
    await page.getByRole('button', { name: 'Create trip' }).click();
    const trips = page.locator('#trips-tab');
    await trips.getByRole('button', { name: '👥 Share' }).click();
    const sharing = page.locator('dialog.dialog', { hasText: 'together' });
    await sharing.getByLabel('Username to share with').fill(ben);
    await sharing.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(sharing.locator('.member')).toContainText(ben);
    await sharing.getByRole('button', { name: 'Done' }).click();

    await other.reload();
    await other.click('#tab-trips');
    await expect(other.locator('.trip-card')).toContainText(`👥 ${ana}`);
    await other.locator('.trip-card').click();
    const shared = other.locator('#trips-tab');
    await expect(shared.locator('.trip-shared')).toContainText(`Shared by ${ana} · you can edit it`);
    await shared.locator('.day-card').first().getByPlaceholder('Morning plans…').fill('Fushimi Inari at dawn');
    await shared.getByRole('button', { name: '💾 Save' }).click();
    await expect(other.locator('.toast-success', { hasText: 'Trip saved.' })).toBeVisible();
    await expect(shared.getByRole('button', { name: '🗑️ Delete trip' })).toHaveCount(0);

    // Ana's older copy cannot overwrite Ben's change: hers is replaced by his.
    await trips.locator('.day-card').first().getByPlaceholder('Morning plans…').fill('Sleep in');
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-error')).toContainText('Someone else saved this trip');
    await expect(trips.locator('.day-card').first().getByPlaceholder('Morning plans…')).toHaveValue('Fushimi Inari at dawn');

    // Viewing only: nothing to change. Then Ben leaves.
    await trips.getByRole('button', { name: '👥 Share' }).click();
    await sharing.getByLabel(`${ben}'s role`).selectOption('view');
    await sharing.getByRole('button', { name: 'Done' }).click();
    await other.reload();
    await other.click('#tab-trips');
    await other.locator('.trip-card').click();
    await expect(shared.locator('.trip-shared')).toContainText('you can view it');
    await expect(shared.locator('.day-card').first().getByPlaceholder('Morning plans…')).toBeDisabled();
    await expect(shared.getByRole('button', { name: '💾 Save' })).toHaveCount(0);
    await shared.getByRole('button', { name: '🚪 Leave trip' }).click();
    await other.getByRole('button', { name: 'Leave trip' }).last().click();
    await expect(other.locator('.trip-card')).toHaveCount(0);
    await other.close();
    expect(errors).toEqual([]);
});
