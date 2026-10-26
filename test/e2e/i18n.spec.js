'use strict';

// Languages (ADR 0031): a French browser gets the app in French with French country names, a
// traveler switches to Arabic and the page reads right to left, and the free calculator speaks
// German from its own picker. Expected texts come from the catalogs, not copies of them.
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const { browserDay, stubThirdParties, trackErrors } = require('./helpers');

const catalog = locale => require(`../../public/locales/${locale}.json`);
const fr = catalog('fr');
const ar = catalog('ar');
const de = catalog('de');
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);

test.beforeEach(({ page }) => stubThirdParties(page));

test.describe('in a French browser', () => {
    test.use({ locale: 'fr-FR' });

    test('the app speaks French, then Arabic from right to left once chosen', async ({ page }) => {
        test.setTimeout(90_000);
        const errors = trackErrors(page);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
        await expect(page.locator('#home').getByRole('button', { name: fr['Explore the demo map'] }).first()).toBeVisible();
        await expect(page).toHaveTitle(fr['TravelMapster: travel map and Schengen day ledger']);

        // Countries are found by their French names and shown with them.
        await page.locator('#home').getByRole('button', { name: fr['Explore the demo map'] }).first().click();
        await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
        await page.fill('#global-search', 'Allemagne');
        await expect(page.locator('#search-results [role="option"]').first()).toContainText('Allemagne');

        await page.goto('about:blank');
        await page.goto('/#sign-up');
        await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
        await page.click('#tab-register');
        await expect(page.locator('#auth-submit')).toHaveText(fr['Create my map']);
        await page.fill('#auth-username', `e2e_lang_${Date.now()}`);
        await page.fill('#auth-password', 'end to end password');
        await page.click('#auth-submit');
        await expect(page.locator('#main-view')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#tab-ledger')).toContainText(fr['{1}Ledger{2}'].replace(/\{\d\}/g, ''));
        await page.click('#tab-ledger');
        await expect(page.locator('#ledger-tab h2')).toHaveText(fr['Day ledger']);

        // Arabic from Settings: the page reloads right to left, the panel on the right.
        await page.click('#account-btn');
        await page.click('#settings-btn');
        await page.locator('#dialog-locale').selectOption('ar');
        await page.getByRole('button', { name: fr['Save settings'] }).click();
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(page.locator('#main-view')).toBeVisible({ timeout: 15_000 });
        const panel = await page.locator('#panel').boundingBox();
        expect(panel.x + panel.width / 2).toBeGreaterThan(page.viewportSize().width / 2);
        await page.click('#tab-passport');
        await expect(page.locator('#passport-tab')).toContainText(ar['Stamps']);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(results.violations.map(violation => violation.id)).toEqual([]);
        expect(errors).toEqual([]);
    });
});

test('the calculator switches to German from its own picker', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/schengen-calculator');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('#calculator-language').selectOption('de');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('h1')).toHaveText(fill(de['Schengen {1} calculator'], { 1: '90/180' }));
    // Ten days within the 180 before today.
    await page.fill('#stay-1-entry', await browserDay(page, -20));
    await page.fill('#stay-1-exit', await browserDay(page, -11));
    await expect(page.locator('#result-title')).toHaveText(fill(de['{used} of {maxDays} days used'], { used: '10', maxDays: '90' }));
    expect(errors).toEqual([]);
});
