'use strict';

// The day ledger: Schengen days, a planned stay, a threshold alert and the evidence report.
const { test, expect } = require('@playwright/test');
const { browserDay, markCity, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a traveler counts Schengen days, tries a plan, gets an alert and prints evidence', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_ledger_${Date.now()}`);
    await markCity(page, 'Lisbon');

    // In Lisbon for the last ten days and still there.
    await page.locator('.card-popup .visit-add').click();
    await page.fill('#dialog-startDate', await browserDay(page, -9));
    await page.check('#dialog-ongoing');
    await page.getByRole('button', { name: 'Add visit' }).click();
    await expect(page.locator('.card-popup .visit')).toContainText('still there');

    await page.click('#tab-ledger');
    const ledger = page.locator('#ledger-tab');
    await expect(ledger.locator('.days-left strong')).toHaveText('80');
    await expect(ledger.locator('.timeline-stay').first()).toContainText('Portugal');
    await expect(ledger.locator('.timeline-stay').first()).toContainText('10 days');
    await expect(ledger.locator('#ledger-advice')).toContainText('not legal or tax advice');
    await ledger.getByText('How your ledger data is kept').click();
    await expect(ledger.locator('#ledger-privacy')).toContainText('never your precise location');

    // Eighty-five more days in Spain would break 90/180.
    await ledger.getByRole('button', { name: '＋ Plan a stay' }).click();
    await page.locator('#dialog-countryId').selectOption('ESP');
    await page.fill('#dialog-startDate', await browserDay(page, 10));
    await page.fill('#dialog-endDate', await browserDay(page, 94));
    await page.getByRole('button', { name: 'Add to plan' }).click();
    await expect(ledger.locator('.plan-outcomes')).toContainText('Schengen 90/180: over the limit');

    // A threshold of ten days in Portugal is reached today.
    await ledger.getByRole('button', { name: '＋ Add a threshold' }).click();
    await page.fill('#dialog-name', 'Portugal test');
    await page.fill('#dialog-countries', 'Portugal');
    await page.fill('#dialog-maxDays', '10');
    await page.fill('#dialog-warnDays', '0');
    await page.getByRole('button', { name: 'Add rule' }).click();
    await expect(ledger.locator('.ledger-alerts')).toContainText('Portugal test reached');
    await expect(page.locator('#ledger-alert-count')).toBeVisible();

    await ledger.getByLabel(/Midnight rule/).check();
    await expect(ledger.getByLabel(/Midnight rule/)).toBeChecked();

    // The evidence lists each day with the visit behind it, and the visit's date history.
    await expect(ledger.locator('.history')).toContainText('Added');
    await ledger.getByRole('button', { name: /View report/ }).click();
    const report = page.locator('#report-view');
    await expect(report).toBeVisible();
    await expect(report.locator('tbody tr')).toHaveCount(1 + 10 + 1);
    await expect(report).toContainText('Arrival day; still there');
    await expect(report).toContainText('not legal or tax advice');
    const download = page.waitForEvent('download');
    await report.getByRole('button', { name: /CSV/ }).click();
    const csv = await (await download).createReadStream().then(stream => stream.toArray()).then(chunks => Buffer.concat(chunks).toString());
    expect(csv.split('\r\n')).toHaveLength(11);
    expect(csv).toContain('"Lisbon, Portugal"');
    await page.keyboard.press('Escape');
    await expect(report).toBeHidden();

    // Settings and plans live in the account.
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-ledger');
    await expect(ledger.locator('.plan-outcomes')).toContainText('over the limit');
    await expect(ledger.getByLabel(/Midnight rule/)).toBeChecked();
    await expect(page.locator('.toast', { hasText: 'Day ledger' })).toBeVisible();
    expect(errors).toEqual([]);
});
