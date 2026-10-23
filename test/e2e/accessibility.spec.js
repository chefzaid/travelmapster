'use strict';

const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');

// WCAG 2.2 level A and AA rules, including colour contrast, in both themes.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page, state) {
    // Audit settled colours: a fade-in such as the dialog's pop-in fails contrast mid-animation.
    await page.evaluate(() => Promise.all(globalThis.document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {}))));
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
        // One journey audits every screen and dialog, which takes longer than a single flow.
        test.setTimeout(90_000);
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

        await page.locator('.card-popup .visit-add').click();
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'visit dialog');
        await page.fill('#dialog-startDate', '2024-05-01');
        await page.fill('#dialog-endDate', '2024-05-04');
        await page.fill('#dialog-notes', 'Custard tarts by the river');
        await page.getByRole('button', { name: 'Add visit' }).click();
        await expect(page.locator('.card-popup .visit')).toHaveCount(1);
        await page.waitForTimeout(500);
        await expectAccessible(page, 'place card with a visit');

        // Rating, emoji and tags (ADR 0012).
        await page.locator('.card-popup .link-btn', { hasText: 'Edit details' }).click();
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await page.selectOption('#dialog-rating', '5');
        await page.getByRole('button', { name: 'Use 🍜' }).click();
        await page.locator('.choice-chip', { hasText: '#food' }).click();
        await expectAccessible(page, 'place details dialog');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.locator('dialog.dialog')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // A layover and a home country, drawn and listed apart (ADR 0014).
        await page.fill('#global-search', 'Dubai');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Dubai' }).first().click();
        await page.locator('.card-actions button', { hasText: 'Transit only' }).click();
        await expect(page.locator('.maplibregl-popup.card-popup .card-status .chip-transit')).toBeVisible();
        await page.waitForTimeout(500);
        await expectAccessible(page, 'transit place card');
        await page.keyboard.press('Escape');
        await page.click('#account-btn');
        await page.click('#settings-btn');
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await page.selectOption('#dialog-homeCountry', 'PRT');
        await expectAccessible(page, 'settings dialog');
        await page.getByRole('button', { name: 'Save settings' }).click();
        await expect(page.locator('dialog.dialog')).toHaveCount(0);

        for (const tab of ['explore', 'places', 'ledger', 'trips', 'passport']) {
            await page.click(`#tab-${tab}`);
            await expect(page.locator(`#${tab}-tab`)).toBeVisible();
            await expectAccessible(page, `${tab} tab`);
        }

        // A tag filter narrows the list and the map, and the legend offers to clear it.
        await page.click('#tab-places');
        await page.selectOption('#tag-filter', 'food');
        await expect(page.locator('#legend-detail-filter')).toBeVisible();
        await expectAccessible(page, 'places filtered by tag');
        await page.click('#legend-detail-filter');
        await expect(page.locator('#legend-detail-filter')).toBeHidden();

        // Picking countries on the map to mark them at once.
        await page.click('#bulk-pick');
        await page.fill('#global-search', 'Peru');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Peru' }).first().click();
        await expect(page.locator('#select-count')).toHaveText('1 country selected');
        await expectAccessible(page, 'country picking bar');
        await page.click('#select-cancel');
        await expect(page.locator('#select-bar')).toBeHidden();

        // Day ledger: a rule dialog and the printable evidence report.
        await page.click('#tab-ledger');
        await page.getByRole('button', { name: '＋ Add a threshold' }).click();
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'threshold dialog');
        await page.getByRole('button', { name: 'Cancel' }).click();
        await page.fill('#report-from', '2024-01-01');
        await page.getByRole('button', { name: /View report/ }).click();
        await expect(page.locator('#report-view tbody tr').nth(3)).toBeVisible();
        await expectAccessible(page, 'evidence report');
        await page.locator('#report-view').getByRole('button', { name: 'Close' }).click();

        await page.click('#account-btn');
        await expectAccessible(page, 'account menu');
        await page.click('#password-btn');
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'change password dialog');
    });
}

for (const colorScheme of ['light', 'dark']) {
    test(`public pages meet WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        // Landing page with a demo place card open.
        await page.goto('/');
        await expect(page.locator('#demo-ledger')).toContainText('Schengen days');
        await page.fill('#global-search', 'Lisbon');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Lisbon' }).first().click();
        await expect(page.locator('.maplibregl-popup.card-popup .card-status .chip-visited')).toBeVisible();
        await page.waitForTimeout(500);
        await expectAccessible(page, 'demo place card');

        // The Schengen calculator with a result, an overstay and a faulty row.
        await page.goto('/schengen-calculator');
        await expectAccessible(page, 'empty calculator');
        await page.fill('#stay-1-entry', '2026-01-01');
        await page.fill('#stay-1-exit', '2026-04-30');
        await page.click('#add-stay');
        await page.fill('#stay-2-entry', '2026-06-01');
        await page.fill('#stay-2-exit', '2026-05-01');
        await page.fill('#check-date', '2026-03-01');
        await expect(page.locator('.overstay')).toBeVisible();
        await expect(page.locator('#stay-2-error')).toBeVisible();
        await expectAccessible(page, 'calculator with an overstay');
    });
}
