'use strict';

// Importing from other travel apps (a pasted list of countries, a Polarsteps data export) and
// from photos and location history, each previewed before anything is saved.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { addPlaces, markCity, signUp, stubThirdParties, trackErrors } = require('./helpers');

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

test('a traveler imports visits found in photos, location history and a calendar, reviewing each visit', async ({ page }) => {
    const errors = trackErrors(page);
    const { jpeg } = require('../fixtures/photos');
    await signUp(page, `e2e_photos_${Date.now()}`);
    await markCity(page, 'Lisbon');
    await page.keyboard.press('Escape');
    await page.click('#tab-places');

    // Photos are read in the browser and reduced to the nearest town.
    await page.setInputFiles('#photos-file', [
        { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: jpeg({ date: '2024:05:12 18:03:00', lat: 38.7105, lng: -9.1366 }) },
        { name: 'IMG_0002.jpg', mimeType: 'image/jpeg', buffer: jpeg({ date: '2024:05:13 10:00:00', lat: 38.7139, lng: -9.1334 }) },
        { name: 'IMG_0003.jpg', mimeType: 'image/jpeg', buffer: jpeg({ date: '2024:05:15 12:00:00', lat: 41.1496, lng: -8.611 }) },
        { name: 'IMG_0004.jpg', mimeType: 'image/jpeg', buffer: jpeg({ date: '2024:05:16 12:00:00' }) }
    ]);
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toContainText('2 visits to 2 places');
    await expect(dialog).toContainText('1 photo has no place or date');
    await expect(dialog.locator('legend', { hasText: 'Lisbon, Portugal (on your map)' })).toBeVisible();
    // Each visit is the traveler's to keep: Porto's is left out.
    await dialog.locator('fieldset', { hasText: 'Porto, Portugal' }).locator('.choice-chip').click();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.toast-success', { hasText: 'Imported 1 visit to places you had.' })).toBeVisible();
    await expect(page.locator('#places-tab .place', { hasText: 'Lisbon' })).toContainText('1 visit');
    await expect(page.locator('#places-tab .place', { hasText: 'Porto' })).toHaveCount(0);

    // A Timeline export from a phone: stays only, the trip between them is left out.
    const timeline = { semanticSegments: [
        { startTime: '2024-07-01T15:00:00.000+02:00', endTime: '2024-07-03T10:00:00.000+02:00', visit: { topCandidate: { placeLocation: { latLng: '41.3874°, 2.1686°' } } } },
        { startTime: '2024-07-03T10:00:00.000+02:00', endTime: '2024-07-03T12:00:00.000+02:00', timelinePath: [{ point: '41.0°, 1.5°' }] }
    ] };
    await page.setInputFiles('#history-file', { name: 'Timeline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(timeline)) });
    await expect(dialog).toContainText('1 visit to 1 place');
    await expect(dialog).toContainText('Barcelona, Spain');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.toast-success', { hasText: 'Imported 1 new place.' })).toBeVisible();
    await expect(page.locator('#places-tab .place', { hasText: 'Barcelona' })).toContainText('1 visit');

    // A calendar file: a weekend and a flight are travel; a meeting and a birthday are not.
    const calendar = ['BEGIN:VCALENDAR',
        'BEGIN:VEVENT', 'SUMMARY:Lisbon weekend', 'DTSTART;VALUE=DATE:20240920', 'DTEND;VALUE=DATE:20240923', 'LOCATION:Lisbon\\, Portugal', 'END:VEVENT',
        'BEGIN:VEVENT', 'SUMMARY:Flight to Madrid', 'DTSTART:20240923T170000Z', 'DTEND:20240923T190000Z', 'LOCATION:Lisbon Airport', 'END:VEVENT',
        'BEGIN:VEVENT', 'SUMMARY:Team meeting', 'DTSTART:20240924T090000Z', 'DTEND:20240924T100000Z', 'LOCATION:Room 4B', 'END:VEVENT',
        'BEGIN:VEVENT', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20240612', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
        'END:VCALENDAR'].join('\r\n');
    await page.setInputFiles('#calendar-file', { name: 'trips.ics', mimeType: 'text/calendar', buffer: Buffer.from(calendar) });
    await expect(dialog).toContainText('2 visits to 2 places, from your calendar.');
    await expect(dialog).toContainText('From 2 events that look like travel.');
    await expect(dialog.locator('legend', { hasText: 'Lisbon, Portugal (on your map)' })).toBeVisible();
    await expect(dialog.locator('legend', { hasText: 'Madrid, Spain' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.toast-success', { hasText: 'Imported 1 new place and 1 visit to places you had.' })).toBeVisible();
    await expect(page.locator('#places-tab .place', { hasText: 'Madrid' })).toContainText('1 visit');
    expect(errors).toEqual([]);
});

test('two pins for one town are offered as a duplicate and merged, keeping both visits', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_merge_${Date.now()}`);
    const pin = (name, lat, startDate) => ({ lat, lng: -9.14, type: 'visited', name, category: 'City', visits: [{ startDate, endDate: startDate }] });
    await addPlaces(page, [pin('Lisbon, Portugal', 38.72, '2024-05-01'), pin('Lisboa, Portugal', 38.721, '2025-03-02')]);
    await page.click('#tab-places');
    const duplicates = page.locator('#duplicates li');
    await expect(duplicates).toHaveCount(1);
    await expect(duplicates).toContainText('Lisbon, Portugal and Lisboa, Portugal');
    await duplicates.getByRole('button', { name: 'Merge' }).click();
    await expect(page.locator('dialog.dialog')).toContainText('takes 1 visit');
    await page.locator('dialog.dialog').getByRole('button', { name: 'Merge' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Merged into Lisbon, Portugal.' })).toBeVisible();
    await expect(page.locator('#duplicates')).toHaveCount(0);
    await expect(page.locator('#places-tab .place')).toHaveCount(1);
    await expect(page.locator('#places-tab .place')).toContainText('2 visits');
    expect(errors).toEqual([]);
});
