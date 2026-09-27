'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    // Keep tests hermetic: no third-party guide lookups.
    await page.route(/wikivoyage\.org/, route => route.fulfill({ json: { query: { search: [] } } }));
});

function trackErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        // Expected 401s (signed-out session checks) are not failures; CSP violations are.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
            errors.push(message.text());
        }
    });
    return errors;
}

async function signUp(page, username) {
    await page.goto('/');
    await page.click('#tab-register');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'end to end password');
    await page.click('#auth-submit');
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#account-name')).toHaveText(username);
}

async function markCity(page, name) {
    await page.fill('#global-search', name);
    await page.locator('#search-results [role="option"]').filter({ hasText: name }).first().click();
    await page.locator('.card-actions button', { hasText: 'Been there' }).last().click();
}

test('a traveler signs up, colors in a city, shares a public map and logs out', async ({ page, browser }) => {
    const errors = trackErrors(page);
    const username = `e2e_${Date.now()}`;
    await signUp(page, username);

    await markCity(page, 'Lisbon');
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // The place survives a reload, so it was persisted through the API.
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // Passport renders progress bars with inline styles; the CSP must allow them.
    await page.click('#tab-passport');
    await expect(page.locator('#passport-tab')).toBeVisible();
    await page.click('#tab-places');
    await expect(page.locator('#places-tab')).toContainText('Lisbon');

    await page.click('#account-btn');
    await page.locator('label.switch').click();
    await expect(page.locator('#copy-share-btn')).toBeEnabled();

    const visitor = await browser.newPage();
    await visitor.route(/wikivoyage\.org/, route => route.abort());
    await visitor.goto(`/?u=${username}`);
    await expect(visitor.locator('#public-view')).toBeVisible();
    await expect(visitor.locator('#public-title')).toContainText(username);
    await visitor.close();

    await page.click('#logout-btn');
    await expect(page.locator('#welcome-view')).toBeVisible();
    expect(errors).toEqual([]);
});

test('private maps are not shared', async ({ page }) => {
    const username = `e2e_private_${Date.now()}`;
    await signUp(page, username);
    const visitor = await page.context().browser().newPage();
    await visitor.goto(`/?u=${username}`);
    await expect(visitor.locator('.toast-error')).toContainText('Profile not found');
    await expect(visitor.locator('#welcome-view')).toBeVisible();
    await expect(visitor.locator('#public-view')).toBeHidden();
    await visitor.close();
});

test('login errors are shown inline', async ({ page }) => {
    await page.goto('/');
    await page.fill('#auth-username', 'nobody_here');
    await page.fill('#auth-password', 'wrong password');
    await page.click('#auth-submit');
    await expect(page.locator('#auth-error')).toHaveText('Invalid username or password.');
});

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
    expect(errors).toEqual([]);
});

test('a traveler changes their password, then deletes their account', async ({ page }) => {
    const errors = trackErrors(page);
    const username = `e2e_account_${Date.now()}`;
    await signUp(page, username);

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

    await page.click('#account-btn');
    await page.click('#delete-account-btn');
    await page.fill('#dialog-password', 'a brand new password');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.locator('#welcome-view')).toBeVisible();

    await page.click('#tab-login');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'a brand new password');
    await page.click('#auth-submit');
    await expect(page.locator('#auth-error')).toHaveText('Invalid username or password.');
    expect(errors).toEqual([]);
});

test('towns drawn on the map open their card when clicked', async ({ page }) => {
    // Reach the Leaflet map to aim at a town on the canvas.
    await page.addInitScript(() => {
        let leaflet;
        Object.defineProperty(globalThis, 'L', { configurable: true, get: () => leaflet, set: value => {
            leaflet = value;
            value.Map.addInitHook(function () { globalThis.__travelMap = this; });
        } });
    });
    await page.goto('/');
    await expect(page.locator('#welcome-view')).toBeVisible();
    const point = await page.evaluate(() => new Promise(resolve => {
        const map = globalThis.__travelMap;
        map.once('moveend', () => setTimeout(() => resolve(map.latLngToContainerPoint([50.833, 4.367])), 1500));
        map.setView([50.833, 4.367], 11, { animate: false });
    }));
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + point.x, box.y + point.y);
    await expect(page.locator('.leaflet-popup .card-header h3')).toHaveText('Ixelles');
});
