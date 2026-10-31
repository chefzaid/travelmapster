'use strict';

// The day ledger: days on the map, Schengen days, a planned stay, a threshold alert and the
// evidence report.
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

    // Days on the map: the legend's steps replace the statuses, and Portugal's card has its days.
    await page.click('#legend-days');
    await expect(page.locator('#legend-days')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend [data-filter="visited"]')).toBeHidden();
    const steps = page.locator('#legend-heat .legend-item');
    await expect(steps).toHaveCount(4);
    await expect(steps.first()).toContainText('1–29 days: 1 country');
    await expect(steps.last()).toContainText('183+ days: 0 countries');
    await page.fill('#global-search', 'Portugal');
    await page.locator('#search-results [role="option"]').filter({ hasText: 'Portugal' }).first().click();
    await expect(page.locator('.card-popup .card-facts')).toContainText('Days here10 days');
    await page.click('#legend-days');
    await expect(page.locator('#legend [data-filter="visited"]')).toBeVisible();
    await expect(page.locator('#legend-heat')).toBeHidden();

    await page.click('#tab-ledger');
    const ledger = page.locator('#ledger-tab');
    await expect(ledger.locator('.days-left strong')).toHaveText('80');
    await expect(ledger.locator('.timeline-stay').first()).toContainText('Portugal');
    await expect(ledger.locator('.timeline-stay').first()).toContainText('10 days');
    // Still there and nothing since: the record is sound.
    await expect(ledger.locator('#health-title').locator('..')).toContainText('All good');

    // Where was I? The last 30 days at first: twenty with no visit, then ten in Lisbon.
    const where = ledger.locator('.whereabouts');
    await expect(where.locator('li')).toHaveCount(2);
    await expect(where.locator('li').first()).toContainText('20 days');
    await expect(where.locator('li').first()).toContainText('No visit recorded');
    await expect(where.locator('li').last()).toContainText('10 days');
    await expect(where.locator('li').last()).toContainText('Portugal: Lisbon');
    await ledger.locator('#where-from').fill(await browserDay(page, -3));
    await ledger.locator('#where-from').dispatchEvent('change');
    await expect(where.locator('li')).toHaveCount(1);
    await expect(where.locator('li')).toContainText('4 days');
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

    // The travel history for visa forms: the stay in Portugal, still going on; the planned
    // stay in Spain is not part of it.
    await expect(ledger.locator('#history-title + p + label + p')).toHaveText('1 stay abroad in this period.');
    await ledger.getByRole('button', { name: /View history/ }).click();
    await expect(report.locator('tbody tr')).toHaveCount(1);
    await expect(report.locator('tbody tr')).toContainText('Portugal');
    await expect(report.locator('tbody tr')).toContainText('still there');
    await expect(report.locator('tbody tr')).toContainText('Tourism or personal');
    const historyDownload = page.waitForEvent('download');
    await report.getByRole('button', { name: /CSV/ }).click();
    expect((await historyDownload).suggestedFilename()).toBe('travelmapster-travel-history-10-years.csv');
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
