'use strict';

// Guest mode (ADR 0026): a visitor uses the app without an account, the map is kept in the
// browser, and signing up moves it into the new account.
const { test, expect } = require('@playwright/test');
const { markCity, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a guest keeps a map in the browser, then saves it to a new account', async ({ page }) => {
    const errors = trackErrors(page);
    const writes = [];
    page.on('request', request => {
        if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(new URL(request.url()).pathname);
    });
    await page.goto('/');
    await page.locator('#home').getByRole('button', { name: 'Try it without an account' }).click();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('.guest-note')).toContainText('Guest map: kept in this browser only.');
    await expect(page.locator('#account-name')).toHaveText('Guest');

    await markCity(page, 'Lisbon');
    await page.keyboard.press('Escape');
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Kyoto');
    await page.getByRole('button', { name: 'Create trip' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip created' })).toBeVisible();
    expect(writes, 'nothing is sent to the server').toEqual([]);

    // The account menu offers what a guest can do.
    await page.click('#account-btn');
    await expect(page.locator('#public-toggle')).toBeHidden();
    await expect(page.locator('#delete-account-btn')).toBeHidden();
    await expect(page.locator('#guest-clear-btn')).toBeVisible();
    await page.keyboard.press('Escape');

    // Back in this browser, the guest map opens again.
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // Leaving keeps the map for next time.
    await page.click('#account-btn');
    await page.getByRole('button', { name: '👋 Leave guest map' }).click();
    await expect(page.locator('#welcome-view')).toBeVisible();
    await expect(page.locator('#welcome-view').getByRole('button', { name: 'Continue your guest map' })).toBeVisible();
    await page.locator('#welcome-view').getByRole('button', { name: 'Continue your guest map' }).click();
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // Signing up takes the guest map along.
    await page.locator('.guest-note').getByRole('button', { name: 'Save it to a free account' }).click();
    await expect(page.locator('#tab-register')).toHaveAttribute('aria-selected', 'true');
    await page.fill('#auth-username', `e2e_guest_${Date.now()}`);
    await page.fill('#auth-password', 'end to end password');
    await page.click('#auth-submit');
    await expect(page.locator('.toast-success', { hasText: 'Your guest map is now saved in your account.' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await expect(page.locator('.guest-note')).toBeHidden();
    await page.click('#tab-trips');
    await expect(page.locator('.trip-card')).toContainText('Kyoto');

    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#legend-visited')).toHaveText('1');
    expect(await page.evaluate(() => globalThis.localStorage.getItem('travelmapster.guest'))).toBeNull();
    expect(errors).toEqual([]);
});

test('logging in to an account with a map asks before adding the guest map to it', async ({ page, browser }) => {
    const errors = trackErrors(page);
    const username = `e2e_merge_${Date.now()}`;
    // An account with a place of its own, made in another browser.
    const other = await browser.newPage();
    await stubThirdParties(other);
    await other.goto('/#sign-up');
    await expect(other.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    await other.fill('#auth-username', username);
    await other.fill('#auth-password', 'end to end password');
    await other.click('#auth-submit');
    await expect(other.locator('#main-view')).toBeVisible({ timeout: 15_000 });
    await markCity(other, 'Porto');
    await other.close();

    await page.goto('/');
    await page.locator('#home').getByRole('button', { name: 'Try it without an account' }).click();
    await expect(page.locator('#app[data-map="ready"] #main-view')).toBeVisible();
    await markCity(page, 'Tokyo');
    await page.keyboard.press('Escape');
    await page.click('#account-btn');
    await page.getByRole('button', { name: '👋 Leave guest map' }).click();
    await page.click('#tab-login');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'end to end password');
    await page.click('#auth-submit');
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toContainText('a guest map with 1 place and 0 trips');
    await dialog.getByRole('button', { name: 'Add them' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Your guest map is now part of your account.' })).toBeVisible();
    await expect(page.locator('#legend-visited')).toHaveText('2');
    expect(errors).toEqual([]);
});
