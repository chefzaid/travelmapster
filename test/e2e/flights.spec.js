'use strict';

// The passport's flight log (flights by airport codes, the distance and CO₂ per year, the
// replay on the map, removing a flight) and the states and provinces of the largest countries.
const { test, expect } = require('@playwright/test');
const { markCity, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a traveler logs flights by airport codes and sees how far they flew each year', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_flights_${Date.now()}`);
    await expect(page.locator('#app[data-map="ready"] #main-view')).toBeVisible();
    await page.click('#tab-passport');
    const log = page.locator('#passport-tab section', { has: page.locator('#flights-title') });
    await expect(log).toContainText('Add the flights you took');

    // Each flight is saved, and the log redrawn, before the next one is typed.
    let added = 0;
    const addFlight = async (date, from, to, number = '', { valid = true } = {}) => {
        await log.locator('input[name="date"]').fill(date);
        await log.getByLabel('From airport code').fill(from);
        await log.getByLabel('To airport code').fill(to);
        await log.locator('input[name="number"]').fill(number);
        await log.getByRole('button', { name: '＋ Add flight' }).click();
        if (valid) await expect(log.locator('#flight-list li')).toHaveCount(++added);
    };
    await log.getByLabel('From airport code').fill('lis');
    await expect(log).toContainText('Lisbon (LIS)');
    await addFlight('2026-05-01', 'lis', 'kix', 'tp 1352');
    await expect(page.locator('.toast-success', { hasText: 'Flight added: Lisbon (LIS) to Osaka (KIX).' })).toBeVisible();
    await addFlight('2026-05-20', 'KIX', 'LIS');
    await addFlight('2025-08-02', 'LIS', 'OPO');
    await expect(log.locator('.flight-total')).toContainText('3 flights');
    await expect(log.locator('.flight-years li')).toHaveCount(2);
    await expect(log.locator('.flight-years li').first()).toContainText('2026: 2 flights');
    await expect(log.locator('#flight-list li').first()).toContainText('Osaka (KIX) → Lisbon (LIS)');
    await expect(log.locator('#flight-list li').nth(1)).toContainText('TP 1352');
    // The list narrows to a year, and back to all of them.
    await log.getByRole('combobox', { name: /^Show/ }).selectOption('2025');
    await expect(log.locator('#flight-list li')).toHaveCount(1);
    await expect(log.locator('#flight-list li')).toContainText('Porto (OPO)');
    await log.getByRole('combobox', { name: /^Show/ }).selectOption('');
    await expect(log.locator('#flight-list li')).toHaveCount(3);

    // A flight changes in place: Porto becomes Faro.
    await log.getByRole('button', { name: /Edit the flight of .* from LIS to OPO/ }).click();
    await page.fill('#dialog-to', 'fao');
    await page.getByRole('button', { name: 'Save flight' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Flight saved.' })).toBeVisible();
    await expect(log.locator('#flight-list li').nth(2)).toContainText('Faro (FAO)');
    await log.getByRole('button', { name: /Edit the flight of .* from LIS to FAO/ }).click();
    await page.fill('#dialog-to', 'opo');
    await page.getByRole('button', { name: 'Save flight' }).click();
    await expect(log.locator('#flight-list li').nth(2)).toContainText('Porto (OPO)');

    // The way back fills the form the other way round, for its day to be picked.
    await log.getByRole('button', { name: 'Add the way back from OPO to LIS' }).click();
    await expect(log.getByLabel('From airport code')).toHaveValue('OPO');
    await expect(log.getByLabel('To airport code')).toHaveValue('LIS');
    await expect(log).toContainText('Porto (OPO)');
    await expect(log.locator('input[name="date"]')).toBeFocused();
    await expect(log.locator('input[name="date"]')).toHaveAttribute('min', '2025-08-02');
    await log.getByLabel('From airport code').fill('');
    await log.getByLabel('To airport code').fill('');

    // A typo is caught before it is saved.
    await addFlight('2026-06-01', 'LIS', 'LIS', '', { valid: false });
    await expect(page.locator('.toast-error')).toContainText('another airport');

    // Many at once, pasted from an app's export: one is known already, one line is not understood.
    await log.getByRole('button', { name: '📥 Paste flights' }).click();
    await page.fill('#dialog-text', '2026-05-20 KIX LIS\n2024-03-03 LIS MAD IB3101\nboarding pass\n2024-03-07 MAD LIS');
    await page.getByRole('button', { name: 'Read them' }).click();
    const preview = page.locator('dialog.dialog', { hasText: 'Add 2 flights?' });
    await expect(preview).toContainText('1 is already in your log.');
    await expect(preview).toContainText('Not understood: boarding pass');
    await preview.getByRole('button', { name: 'Add them' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Added 2 flights.' })).toBeVisible();
    await expect(log.locator('.flight-total')).toContainText('5 flights');
    await expect(log.locator('.flight-years li')).toHaveCount(3);

    // Out and back count as one route; Lisbon is the busiest airport.
    await expect(log.locator('.flight-favourites')).toHaveText('Most flown: KIX ⇄ LIS, 2 times · Busiest airport: Lisbon (LIS), 5 flights');
    const csv = page.waitForEvent('download');
    await log.getByRole('button', { name: '⬇️ CSV' }).click();
    const file = await (await csv).createReadStream().then(stream => stream.toArray()).then(chunks => Buffer.concat(chunks).toString());
    expect(file.split('\r\n')[0]).toBe('date,from,to,flight,km');
    expect(file).toContain('2026-05-01,LIS,KIX,TP 1352,');

    // The latest year as a picture, downloaded where the browser has no share sheet.
    const picture = page.waitForEvent('download');
    await log.getByRole('button', { name: '📸 2026 in flights' }).click();
    expect((await picture).suggestedFilename()).toBe('travelmapster-flights-2026.png');
    // The year's recap picture reads the flight log too.
    const recap = page.waitForEvent('download');
    await page.locator('#share-pictures').getByRole('button', { name: /recap/ }).click();
    expect((await recap).suggestedFilename()).toMatch(/^travelmapster-recap-\d{4}-.*\.png$/);
    await log.getByRole('button', { name: '🗺️ Replay on the map' }).click();
    await log.getByRole('button', { name: /Remove the flight of .* from LIS to OPO/ }).click();
    await expect(log.locator('.flight-total')).toContainText('4 flights');
    // Undo in the toast puts it back; removed again, it stays gone.
    await page.locator('.toast').filter({ hasText: 'Flight removed.' }).getByRole('button', { name: 'Undo' }).click();
    await expect(log.locator('.flight-total')).toContainText('5 flights');
    await log.getByRole('button', { name: /Remove the flight of .* from LIS to OPO/ }).click();
    await expect(log.locator('.flight-total')).toContainText('4 flights');
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-passport');
    await expect(log.locator('#flight-list li')).toHaveCount(4);
    expect(errors).toEqual([]);
});

test('towns been to count for the states and provinces of the largest countries', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_regions_${Date.now()}`);
    await expect(page.locator('#app[data-map="ready"] #main-view')).toBeVisible();
    await page.click('#tab-passport');
    const regions = page.locator('#passport-tab section', { has: page.locator('#regions-title') });
    await expect(regions).toContainText('United States of America');
    for (const town of ['Austin', 'Houston', 'Sydney']) await markCity(page, town);
    await page.click('#tab-passport');
    await expect(regions.locator('.region-list li')).toHaveCount(2);
    await expect(regions.locator('.region-list li', { hasText: 'United States' })).toContainText('United States of America: 1 of 51');
    await expect(regions.locator('.region-list li', { hasText: 'United States' })).toContainText('Texas (Austin and Houston)');
    await expect(regions.locator('.region-list li', { hasText: 'Australia' })).toContainText('New South Wales (Sydney)');
    expect(errors).toEqual([]);
});

test('a town been to suggests the towns next door, one tap from the wishlist', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_nearby_${Date.now()}`);
    await expect(page.locator('#app[data-map="ready"] #main-view')).toBeVisible();
    await markCity(page, 'Lisbon');
    const card = page.locator('.maplibregl-popup.card-popup');
    const nearby = card.locator('.card-nearby');
    // Closed at first, so the card keeps its height; opening it finds the towns around.
    await nearby.getByText('🚶 Towns next door').click();
    await expect(nearby.locator('li')).toHaveCount(4);
    const first = (await nearby.locator('li strong').first().textContent()).trim();
    await nearby.getByRole('button', { name: `Add ${first} to your wishlist` }).click();
    await expect(page.locator('.toast-success', { hasText: first })).toBeVisible();
    await page.click('#tab-places');
    await expect(page.locator('#places-tab .place-main', { hasText: first })).toBeVisible();
    expect(errors).toEqual([]);
});
