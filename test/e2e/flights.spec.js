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

    const addFlight = async (date, from, to, number = '') => {
        await log.locator('input[name="date"]').fill(date);
        await log.getByLabel('From airport code').fill(from);
        await log.getByLabel('To airport code').fill(to);
        await log.locator('input[name="number"]').fill(number);
        await log.getByRole('button', { name: '＋ Add flight' }).click();
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

    // A typo is caught before it is saved.
    await addFlight('2026-06-01', 'LIS', 'LIS');
    await expect(page.locator('.toast-error')).toContainText('another airport');

    await log.getByRole('button', { name: '🗺️ Replay on the map' }).click();
    await log.getByRole('button', { name: /Remove the flight of .* from LIS to OPO/ }).click();
    await expect(log.locator('.flight-total')).toContainText('2 flights');
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-passport');
    await expect(log.locator('#flight-list li')).toHaveCount(2);
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
