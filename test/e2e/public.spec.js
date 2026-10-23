'use strict';

// Journeys of visitors without an account: the landing page with its demo map, and the free
// Schengen calculator, which must never talk to the API.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
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

// Dates relative to the browser's own today, as the calculator counts them.
function browserDay(page, offset) {
    return page.evaluate(days => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }, offset);
}

test('a visitor counts Schengen days without an account, and nothing leaves the browser', async ({ page }) => {
    const errors = trackErrors(page);
    const apiCalls = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url());
    });
    await page.goto('/schengen-calculator');
    await expect(page.locator('h1')).toContainText('Schengen 90/180 calculator');
    await expect(page.locator('#calculator-result')).toContainText('Add a stay');

    // 40 days some months ago, then here for the last ten days and still here.
    await page.fill('#stay-1-entry', await browserDay(page, -99));
    await page.fill('#stay-1-exit', await browserDay(page, -60));
    await page.click('#add-stay');
    await expect(page.locator('#stay-2-entry')).toBeFocused();
    await page.fill('#stay-2-entry', await browserDay(page, -9));
    await expect(page.locator('#result-title')).toHaveText('50 of 90 days used');
    await expect(page.locator('#days-left')).toHaveText('40');
    await expect(page.locator('#latest-day')).toContainText('Staying on from');
    await expect(page.locator('.overstay')).toHaveCount(0);

    // A long planned stay goes over the limit, and removing it clears the warning.
    await page.click('#add-stay');
    await page.fill('#stay-3-entry', await browserDay(page, 20));
    await expect(page.locator('#stay-3-error')).toContainText('exit day of a planned stay');
    await page.fill('#stay-3-exit', await browserDay(page, 120));
    await expect(page.locator('.overstay')).toContainText('Over the 90-day limit');
    await expect(page.locator('.stay-table tbody tr').nth(2)).toContainText('over');
    await page.getByRole('button', { name: 'Remove stay 3' }).click();
    await expect(page.locator('.overstay')).toHaveCount(0);
    await expect(page.locator('.fits')).toContainText('No overstay');

    // Checking a later entry day says how long a fresh stay could last.
    await page.fill('#check-date', await browserDay(page, 30));
    await expect(page.locator('#latest-day')).toContainText('Entering on');

    expect(apiCalls).toEqual([]);

    // The call to action leads to the sign-up form of the travel map.
    await page.getByRole('link', { name: 'Create my free map' }).click();
    await expect(page.locator('#welcome-view')).toBeVisible();
    await expect(page).toHaveURL(/\/#sign-up$/);
    await expect(page.locator('#tab-register')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#auth-username')).toBeFocused();
    expect(errors).toEqual([]);
});

test('a visitor tries the demo map on the landing page, then signs up to an empty map', async ({ page }) => {
    const errors = trackErrors(page);
    const writes = [];
    page.on('request', request => {
        if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/markers')) writes.push(request.url());
    });
    await page.goto('/');
    await expect(page.locator('#welcome-view')).toBeVisible();
    await expect(page.locator('#demo-ledger')).toContainText('Schengen days');
    await expect(page.locator('#legend-visited')).toHaveText('9');
    await expect(page.locator('.story-keepsakes')).toContainText('Coming soon');
    await expect(page.getByRole('link', { name: /Schengen calculator/ })).toHaveAttribute('href', '/schengen-calculator');

    await page.fill('#global-search', 'Brazil');
    await page.locator('#search-results [role="option"]').filter({ hasText: 'Brazil' }).first().click();
    await page.locator('.card-actions button', { hasText: 'Been there' }).last().click();
    await expect(page.locator('#legend-visited')).toHaveText('10');
    await expect(page.locator('.toast')).toContainText('on the demo map');
    expect(writes).toEqual([]);

    await page.keyboard.press('Escape');
    await page.locator('.hero-actions').getByRole('button', { name: 'Sign up free' }).click();
    await expect(page.locator('#tab-register')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#auth-username')).toBeFocused();
    await page.fill('#auth-username', `e2e_demo_${Date.now()}`);
    await page.fill('#auth-password', 'end to end password');
    await page.click('#auth-submit');
    await expect(page.locator('#main-view')).toBeVisible({ timeout: 15_000 });
    // The demo places were never saved: the new map starts empty.
    await expect(page.locator('#legend-visited')).toHaveText('0');
    expect(errors).toEqual([]);
});
