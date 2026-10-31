'use strict';

// The account: light or dark, changing the password, downloading all the data and deleting
// the account.
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { markCity, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a traveler changes their password, downloads all their data, then deletes their account', async ({ page }) => {
    const errors = trackErrors(page);
    const username = `e2e_account_${Date.now()}`;
    await signUp(page, username);

    // Dark in a light browser, kept after a reload, then back to the system's light.
    const ocean = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await ocean();
    await page.click('#account-btn');
    await page.click('#settings-btn');
    await page.locator('#dialog-theme').selectOption('dark');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect.poll(ocean).toBe('rgb(29, 78, 115)');
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    expect(await ocean()).toBe('rgb(29, 78, 115)');
    await page.click('#account-btn');
    await page.click('#settings-btn');
    await page.locator('#dialog-theme').selectOption('system');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect.poll(ocean).toBe(light);

    await page.click('#account-btn');
    await page.click('#password-btn');
    await page.fill('#dialog-currentPassword', 'end to end password');
    await page.fill('#dialog-newPassword', 'a brand new password');
    await page.fill('#dialog-confirmPassword', 'a brand new password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Password changed.' })).toBeVisible();

    await page.click('#account-btn');
    await page.click('#logout-btn');
    await page.click('#tab-login');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'a brand new password');
    await page.click('#auth-submit');
    await expect(page.locator('#main-view')).toBeVisible();

    // Before leaving, the whole account goes into one archive, and places into map formats.
    await markCity(page, 'Lisbon');
    await page.keyboard.press('Escape');
    await page.click('#account-btn');
    const archive = page.waitForEvent('download');
    await page.click('#export-btn');
    const download = await archive;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^travelmapster-${username}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
    const zip = fs.readFileSync(await download.path());
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(zip.toString('utf8')).toContain('"format": "travelmapster-account"');
    expect(zip.toString('utf8')).toContain('<name>Lisbon, Portugal</name>');
    // A poster of the map, as a vector file.
    await page.click('#account-btn');
    await page.click('#poster-btn');
    await page.selectOption('#dialog-size', 'a2');
    await page.selectOption('#dialog-style', 'night');
    const poster = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download poster' }).click();
    const posterFile = await poster;
    expect(posterFile.suggestedFilename()).toBe('travelmapster-poster-a2.svg');
    const svg = fs.readFileSync(await posterFile.path(), 'utf8');
    expect(svg).toContain('viewBox="0 0 594 420"');
    expect(svg).toContain(`<title>${username}'s travel map</title>`.replace("'", '&apos;'));
    expect(svg).toContain('<title>Portugal</title>');

    await page.click('#tab-places');
    const kml = page.waitForEvent('download');
    await page.getByRole('button', { name: '⬇️ KML' }).click();
    expect((await kml).suggestedFilename()).toMatch(/^travelmapster-places-.*\.kml$/);
    await expect(page.locator('#places-tab')).toContainText('Exported 1 place as KML.');

    await page.click('#account-btn');
    await page.click('#delete-account-btn');
    await page.fill('#dialog-password', 'a brand new password');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();

    await page.click('#tab-login');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'a brand new password');
    await page.click('#auth-submit');
    await expect(page.locator('#auth-error')).toHaveText('Invalid username or password.');
    expect(errors).toEqual([]);
});
