'use strict';

// Importing from other travel apps: a pasted list of countries, and a Polarsteps data export,
// each previewed before anything is saved.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { markCity, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

// Seconds for a local day at noon, as Polarsteps stores times.
const at = day => new Date(`${day}T12:00:00`).getTime() / 1000;

test('a traveler imports countries from a list and trips from a Polarsteps export, after a preview', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_import_${Date.now()}`);
    await markCity(page, 'Lisbon');
    await page.keyboard.press('Escape');
    await page.click('#tab-places');

    // A pasted list: the countries the map knows, and the names it does not.
    await page.getByRole('button', { name: '📋 Paste countries' }).click();
    await page.fill('#dialog-list', 'France\nJapan, Atlantis');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.locator('dialog.dialog')).toContainText('2 places');
    await expect(page.locator('dialog.dialog')).toContainText('Not recognized: Atlantis.');
    await page.locator('dialog.dialog').getByText('Japan').click();
    await page.locator('dialog.dialog').getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.toast-success', { hasText: 'Imported 1 new place.' })).toBeVisible();
    await expect(page.locator('#legend-visited')).toHaveText('2');

    // A Polarsteps export, as a ZIP holding a trip and photos: Lisbon is already on the map.
    const { zip } = await import(path.join(__dirname, '..', '..', 'public', 'js', 'zip.js'));
    const trip = {
        name: 'Portugal by train', end_date: at('2024-05-09'),
        all_steps: [
            { name: 'Lisbon', start_time: at('2024-05-01'), location: { lat: 38.72, lon: -9.14, name: 'Lisbon', detail: 'Portugal' } },
            { name: 'Porto', start_time: at('2024-05-05'), location: { lat: 41.15, lon: -8.61, name: 'Porto', detail: 'Portugal' } }
        ]
    };
    const archive = zip([
        { name: 'trip/portugal_1/trip.json', content: JSON.stringify(trip) },
        { name: 'trip/portugal_1/photos/1.jpg', content: 'not really a photo' }
    ]);
    await page.setInputFiles('#polarsteps-file', { name: 'user_data.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
    await expect(page.locator('dialog.dialog')).toContainText('2 places with 2 visits');
    await expect(page.locator('dialog.dialog')).toContainText('Lisbon, Portugal (on your map)');
    await page.locator('dialog.dialog').getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.toast-success', { hasText: 'Imported 1 new place and 1 visit to places you had.' })).toBeVisible();
    await expect(page.locator('#places-tab .place', { hasText: 'Porto' })).toContainText('1 visit');
    await expect(page.locator('#places-tab .place', { hasText: 'Lisbon' })).toContainText('1 visit');

    // Not a Polarsteps file: nothing happens but a message.
    await page.setInputFiles('#polarsteps-file', { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await expect(page.locator('#places-tab')).toContainText('That file is not a Polarsteps trip.');
    expect(errors).toEqual([]);
});
