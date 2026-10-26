'use strict';

// The installable app (ADR 0021): with the service worker, the map and the traveler's places
// work offline as last loaded, writes wait for the network, and signing out leaves nothing.
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'allow' });

test('the app opens offline with the places last loaded, and keeps nothing after signing out', async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.route(/wikivoyage\.org/, route => route.abort());
    const manifest = await (await page.request.get('/manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));

    const username = `e2e_offline_${Date.now()}`;
    await page.goto('/#sign-up');
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    await page.click('#tab-register');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'offline password');
    await page.click('#auth-submit');
    await expect(page.locator('#main-view')).toBeVisible({ timeout: 15_000 });
    await page.fill('#global-search', 'Lisbon');
    await page.locator('#search-results [role="option"]').filter({ hasText: 'Lisbon' }).first().click();
    await page.locator('.card-actions button', { hasText: 'Been there' }).last().click();
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // Once the service worker controls the page, a visit fills its caches.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.locator('#legend-visited')).toHaveText('1');

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await expect(page.locator('#account-name')).toHaveText(username);
    // A change needs the network, and says so.
    await page.fill('#global-search', 'Porto');
    await page.locator('#search-results [role="option"]').filter({ hasText: 'Porto' }).first().click();
    await page.locator('.card-actions button', { hasText: 'Been there' }).last().click();
    await expect(page.locator('.toast-error')).toContainText('You are offline: this change was not saved.');
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // Signing out drops the copy of the account: offline, the landing page shows instead.
    await context.setOffline(false);
    await page.keyboard.press('Escape');
    await page.click('#account-btn');
    await page.click('#logout-btn');
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    expect(await page.evaluate(async () => (await globalThis.caches.keys()).includes('travelmapster-account'))).toBe(false);
    await context.setOffline(true);
    await page.reload();
    // Signed out, the page starts with the presentation, from the cached copy.
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    await expect(page.locator('#main-view')).toBeHidden();
    await context.setOffline(false);
});
