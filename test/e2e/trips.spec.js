'use strict';

// Trip planning: itineraries, calendar export, the ledger, recording a trip as a visit, printing.
const { test, expect } = require('@playwright/test');
const { browserDay, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a traveler plans a trip that is saved to their account', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_trip_${Date.now()}`);
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Lisbon');
    await page.getByLabel('Trip name').fill('Pastel de nata tour');
    await page.getByLabel('How many days?').fill('2');
    await page.getByRole('button', { name: 'Create trip' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip created: Pastel de nata tour' })).toBeVisible();

    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-trips');
    await expect(page.locator('#trips-tab')).toContainText('Pastel de nata tour');

    // Export to a calendar needs dates; printing and duplicating do not.
    await page.locator('.trip-card', { hasText: 'Pastel de nata tour' }).click();
    const trips = page.locator('#trips-tab');
    await trips.getByRole('button', { name: '📅 Calendar' }).click();
    await expect(page.locator('.toast-error')).toContainText('Choose a start date');
    await trips.getByLabel('Start date').fill('2030-05-01');
    await trips.getByLabel('Start date').dispatchEvent('change');
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' })).toBeVisible();
    const download = page.waitForEvent('download');
    await trips.getByRole('button', { name: '📅 Calendar' }).click();
    expect((await download).suggestedFilename()).toBe('pastel-de-nata-tour.ics');

    // The countdown to it, on the Explore tab and the passport, which shares it as a picture.
    const today = await browserDay(page, 0);
    const daysToGo = Math.round((Date.parse('2030-05-01') - Date.parse(today)) / 86_400_000).toLocaleString('en');
    await page.click('#tab-explore');
    await expect(page.locator('.countdown')).toContainText(`🇵🇹Pastel de nata tour in ${daysToGo} days`);
    await page.click('#tab-passport');
    await expect(page.locator('#passport-tab .stat', { hasText: 'Pastel de nata tour' })).toContainText(`✈️ ${daysToGo}`);
    const card = page.waitForEvent('download');
    await page.getByRole('button', { name: '✈️ Countdown' }).click();
    expect((await card).suggestedFilename()).toBe(`travelmapster-countdown-${today}.png`);
    await page.click('#tab-explore');
    await page.locator('.countdown-btn').click();
    await expect(trips).toBeVisible();

    // Planned in the ledger, the trip's stay follows its dates.
    await trips.getByRole('button', { name: '📒 Plan in ledger' }).click();
    await expect(trips.getByRole('button', { name: '📒 In ledger plans' })).toHaveAttribute('aria-pressed', 'true');
    await page.click('#tab-ledger');
    await expect(page.locator('#ledger-tab .ledger-item', { hasText: 'Pastel de nata tour' })).toContainText('Portugal');
    await expect(page.locator('#ledger-tab .ledger-item', { hasText: 'Pastel de nata tour' })).toContainText('2 days');
    await page.click('#tab-trips');
    await trips.getByRole('button', { name: '＋ Add a day' }).click();
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' }).last()).toBeVisible();
    await page.click('#tab-ledger');
    await expect(page.locator('#ledger-tab .ledger-item', { hasText: 'Pastel de nata tour' })).toContainText('3 days');
    await page.click('#tab-trips');

    await trips.getByRole('button', { name: '🖨️ Print' }).click();
    const sheet = page.locator('#report-view');
    await expect(sheet.locator('h1')).toHaveText('Pastel de nata tour');
    await expect(sheet.locator('tbody tr')).toHaveCount(3);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    await trips.getByRole('button', { name: '⧉ Duplicate' }).click();
    await expect(trips.getByLabel('Trip name')).toHaveValue('Pastel de nata tour (copy)');
    await expect(trips.getByLabel('Start date')).toHaveValue('');
    await trips.getByRole('button', { name: '‹ All trips' }).click();
    await expect(page.locator('.trip-card')).toHaveCount(2);

    // A private calendar link serves the dated trip to calendar apps, until it is turned off.
    await trips.getByRole('button', { name: '📆 Make a private calendar link' }).click();
    const link = await page.locator('#calendar-feed-url').inputValue();
    expect(link).toMatch(/\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    const feed = await page.request.get(link);
    expect(feed.ok()).toBe(true);
    expect(await feed.text()).toContain('SUMMARY:Pastel de nata tour');
    await trips.getByRole('button', { name: 'Turn off' }).click();
    await page.locator('dialog.dialog').getByRole('button', { name: 'Turn off' }).click();
    await expect(trips.getByRole('button', { name: '📆 Make a private calendar link' })).toBeVisible();
    expect((await page.request.get(link)).status()).toBe(404);

    // Deleting the trip takes its stay out of the ledger plans.
    await page.locator('.trip-card', { hasText: 'Pastel de nata tour' }).filter({ hasNotText: 'copy' }).click();
    await trips.getByRole('button', { name: '🗑️ Delete trip' }).click();
    await page.getByRole('button', { name: 'Delete trip' }).last().click();
    await expect(page.locator('.trip-card')).toHaveCount(1);
    await page.click('#tab-ledger');
    await expect(page.locator('#ledger-tab')).not.toContainText('Pastel de nata tour');

    // A trip that has begun is recorded as a visit to its destination, once confirmed.
    await page.click('#tab-trips');
    await page.getByRole('button', { name: '＋ New trip' }).click();
    await page.getByLabel('Where to?').fill('Kyoto');
    await page.getByLabel('Start date').fill('2024-03-01');
    await page.getByLabel('How many days?').fill('2');
    await page.getByRole('button', { name: 'Create trip' }).click();
    await trips.getByRole('button', { name: '✅ Record as a visit' }).click();
    await expect(page.locator('dialog.dialog')).toContainText('Kyoto, Japan: a visit from');
    await page.getByRole('button', { name: 'Add the visit' }).click();
    await expect(trips.getByRole('button', { name: '✓ Recorded as a visit' })).toBeDisabled();
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await page.click('#tab-places');
    await expect(page.locator('#places-tab .place', { hasText: 'Kyoto' })).toContainText('1 visit');
    expect(errors).toEqual([]);
});

test('a trip keeps a packing list and a budget in any currency', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_pack_${Date.now()}`);
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Tokyo');
    await page.getByLabel('How many days?').fill('1');
    await page.getByRole('button', { name: 'Create trip' }).click();
    const trips = page.locator('#trips-tab');

    await trips.getByText('🎒 Packing list').click();
    // The basics are the template picked at first.
    await trips.getByRole('button', { name: '✨ Add these' }).click();
    await trips.getByLabel('Item to pack').fill('Snorkel');
    await trips.getByLabel('Item to pack').press('Enter');
    await trips.getByRole('checkbox', { name: 'Passport or ID' }).check();
    await expect(trips.locator('.trip-extra summary', { hasText: 'Packing list' })).toContainText('1 of 11 packed');

    await trips.getByText('🧾 Budget').click();
    await trips.getByLabel('Home currency').fill('EUR');
    await trips.getByLabel('Home currency').dispatchEvent('change');
    await trips.getByRole('button', { name: 'Start a budget' }).click();
    await trips.getByLabel('Planned budget').fill('1000');
    await trips.getByLabel('Planned budget').dispatchEvent('change');
    const addExpense = async (label, amount, currency) => {
        await trips.getByLabel('New expense').fill(label);
        await trips.getByLabel('Amount', { exact: true }).fill(amount);
        await trips.getByLabel('Currency', { exact: true }).fill(currency);
        await trips.getByLabel('New expense').press('Enter');
    };
    await addExpense('Flights', '600', 'EUR');
    await addExpense('Ryokan', '30000', 'JPY');
    await expect(trips.locator('.budget-totals')).toContainText('Add a rate for JPY');
    await trips.getByLabel('EUR for 1 JPY').fill('0.006');
    await trips.getByLabel('EUR for 1 JPY').dispatchEvent('change');
    await expect(trips.locator('.budget-totals')).toContainText('€780.00');
    await expect(trips.locator('.budget-totals')).toContainText('€220.00 left');

    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' })).toBeVisible();
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-trips');
    await page.locator('.trip-card').first().click();
    await expect(trips.locator('.trip-extra summary', { hasText: 'Packing list' })).toContainText('1 of 11 packed');
    await expect(trips.locator('.trip-extra summary', { hasText: 'Budget' })).toContainText('€780.00 of €1,000.00');

    await trips.getByRole('button', { name: '🖨️ Print' }).click();
    await expect(page.locator('#report-view .report-checklist')).toContainText('☑ Passport or ID');
    await expect(page.locator('#report-view')).toContainText('Spent so far: €780.00');
    await page.keyboard.press('Escape');

    // The list becomes a template of the traveler's own, kept on the account, beside the
    // ready-made ones.
    await trips.getByText('🎒 Packing list').click();
    await trips.getByRole('button', { name: '📋 Save as template' }).click();
    await page.fill('#dialog-name', 'Tokyo kit');
    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Saved the template Tokyo kit.' })).toBeVisible();
    const picker = trips.getByLabel('Packing list template');
    await expect(picker).toHaveValue('own:Tokyo kit');
    await picker.selectOption('beach');
    await trips.getByRole('button', { name: '✨ Add these' }).click();
    await expect(trips.locator('.trip-extra summary', { hasText: 'Packing list' })).toContainText('1 of 19 packed');
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-trips');
    await page.locator('.trip-card').first().click();
    await trips.getByText('🎒 Packing list').click();
    await picker.selectOption({ label: 'Tokyo kit' });
    await trips.getByRole('button', { name: '🗑️ Remove template' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Removed the template Tokyo kit.' })).toBeVisible();
    await expect(picker.locator('option', { hasText: 'Tokyo kit' })).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a trip goes to several places, each planned in the ledger and recorded as a visit', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_stops_${Date.now()}`);
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Lisbon, Portugal');
    await page.getByLabel('Trip name').fill('Iberian loop');
    await page.getByLabel('Start date').fill('2024-04-01');
    await page.getByLabel('How many days?').fill('2');
    await page.getByRole('button', { name: 'Create trip' }).click();
    const trips = page.locator('#trips-tab');

    await trips.getByRole('button', { name: '＋ Add another destination' }).click();
    await trips.getByLabel('Stop 2', { exact: true }).fill('Madrid, Spain');
    await trips.getByLabel('Stop 2', { exact: true }).dispatchEvent('change');
    await trips.getByLabel('Days in stop 2').fill('2');
    await trips.getByLabel('Days in stop 2').dispatchEvent('change');
    await expect(trips.locator('.day-card')).toHaveCount(4);
    await expect(trips.locator('.day-card').nth(2)).toContainText('📍 Madrid, Spain');
    await trips.getByRole('button', { name: '💾 Save' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Trip saved.' })).toBeVisible();

    // One planned stay per country: the travel day counts in both.
    await trips.getByRole('button', { name: '📒 Plan in ledger' }).click();
    await expect(trips.getByRole('button', { name: '📒 In ledger plans' })).toBeVisible();
    await page.click('#tab-ledger');
    const plans = page.locator('#ledger-tab .ledger-item', { hasText: 'Iberian loop' });
    await expect(plans).toHaveCount(2);
    await expect(plans.filter({ hasText: 'Portugal' })).toContainText('3 days');
    await expect(plans.filter({ hasText: 'Spain' })).toContainText('2 days');

    await page.click('#tab-trips');
    await trips.getByRole('button', { name: '✅ Record as a visit' }).click();
    await expect(page.locator('dialog.dialog')).toContainText('Lisbon, Portugal: a visit from');
    await expect(page.locator('dialog.dialog')).toContainText('Madrid, Spain: a visit from');
    await expect(page.locator('dialog.dialog')).toContainText('You can edit visits on the place\'s card.');
    await page.getByRole('button', { name: 'Add the visits' }).click();
    // Two places are saved one after the other.
    await expect(trips.getByRole('button', { name: '✓ Recorded as a visit' })).toBeDisabled({ timeout: 15_000 });
    await expect(page.locator('#legend-visited')).toHaveText('2');

    await trips.getByRole('button', { name: '‹ All trips' }).click();
    await expect(page.locator('.trip-card')).toContainText('Lisbon, Portugal → Madrid, Spain · 4 days');
    expect(errors).toEqual([]);
});

// Drags with the mouse in small steps onto the top of the target, which must be in view with
// the source once the source is centered.
async function dragOnto(page, source, target) {
    await source.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + Math.min(20, to.height / 2), { steps: 8 });
    await page.mouse.up();
}

test('the open trip shows its route on the map, and days and plans move by dragging', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_route_${Date.now()}`);
    await page.click('#tab-trips');
    await page.getByRole('button', { name: 'Plan my first trip' }).click();
    await page.getByLabel('Where to?').fill('Lisbon, Portugal');
    await page.getByLabel('How many days?').fill('2');
    await page.getByRole('button', { name: 'Create trip' }).click();
    const trips = page.locator('#trips-tab');
    await trips.getByRole('button', { name: '＋ Add another destination' }).click();
    await trips.getByLabel('Stop 2', { exact: true }).fill('Madrid, Spain');
    await trips.getByLabel('Stop 2', { exact: true }).dispatchEvent('change');

    // Numbered stops on the map, the route between them, and nothing once the trip is closed.
    const mapData = source => page.evaluate(id => globalThis.document.getElementById('map').travelMap.getSource(id).serialize().data.features.length, source);
    await expect.poll(() => mapData('itinerary-stops')).toBe(2);
    await expect.poll(() => mapData('itinerary')).toBe(1);
    await trips.locator('.day-card').nth(2).getByRole('button', { name: '📍 Madrid, Spain' }).click();

    // Plans move between days with the arrows or by dragging, and swap between slots.
    const morning = day => trips.locator('.day-card').nth(day).getByPlaceholder('Morning plans…');
    await morning(0).fill('Belém tower');
    await morning(1).fill('Sintra');
    await trips.getByRole('button', { name: 'Move day 1 later' }).click();
    await expect(morning(1)).toHaveValue('Belém tower');
    await expect(morning(0)).toHaveValue('Sintra');
    await dragOnto(page, trips.locator('.day-card').nth(1).locator('.drag-handle'), trips.locator('.day-card').nth(0).locator('.slot', { hasText: 'Evening' }));
    await expect(morning(0)).toHaveValue('Belém tower');
    const evening = trips.locator('.day-card').nth(0).getByPlaceholder('Evening plans…');
    await dragOnto(page, trips.locator('.day-card').nth(0).locator('.slot', { hasText: 'Morning' }).locator('span[draggable]'),
        trips.locator('.day-card').nth(0).locator('.slot', { hasText: 'Evening' }));
    await expect(evening).toHaveValue('Belém tower');
    await expect(morning(0)).toHaveValue('');

    await page.click('#tab-places');
    await expect.poll(() => mapData('itinerary-stops')).toBe(0);
    expect(errors).toEqual([]);
});
