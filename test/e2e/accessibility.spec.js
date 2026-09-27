'use strict';

const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');

// WCAG 2.2 level A and AA rules, including colour contrast, in both themes.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page, state) {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const summary = results.violations.map(violation =>
        `${violation.id}: ${violation.help} (${violation.nodes.map(node => node.target.join(' ')).slice(0, 5).join(', ')})`);
    expect(summary, `${state} has no WCAG A/AA violations`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
    await page.route(/wikivoyage\.org/, route => route.fulfill({ json: { query: { search: [] } } }));
});

for (const colorScheme of ['light', 'dark']) {
    test(`every screen meets WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto('/');
        await expect(page.locator('#welcome-view')).toBeVisible();
        await expectAccessible(page, 'welcome');

        await page.click('#tab-register');
        await page.fill('#auth-username', `a11y_${colorScheme}_${Date.now()}`);
        await page.fill('#auth-password', 'accessible password');
        await page.click('#auth-submit');
        await expect(page.locator('#main-view')).toBeVisible();

        await page.fill('#global-search', 'Lisbon');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Lisbon' }).first().click();
        await page.locator('.card-actions button', { hasText: 'Been there' }).last().click();
        // Saving re-renders the card; audit the settled card only.
        await expect(page.locator('.maplibregl-popup.card-popup .card-status .chip-visited')).toBeVisible();
        await page.waitForTimeout(500);
        await expect(page.locator('.maplibregl-popup.card-popup')).toHaveCount(1);
        await expectAccessible(page, 'place card');
        await page.keyboard.press('Escape');

        for (const tab of ['explore', 'places', 'trips', 'passport']) {
            await page.click(`#tab-${tab}`);
            await expect(page.locator(`#${tab}-tab`)).toBeVisible();
            await expectAccessible(page, `${tab} tab`);
        }

        await page.click('#account-btn');
        await expectAccessible(page, 'account menu');
        await page.click('#password-btn');
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'change password dialog');
    });
}
