'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    // Keep tests hermetic: no third-party guide lookups.
    await page.route(/wikivoyage\.org/, route => route.fulfill({ json: { query: { search: [] } } }));
});

function trackErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        // Expected 401s (signed-out session checks) are not failures; CSP violations are.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
            errors.push(message.text());
        }
    });
    return errors;
}

async function signUp(page, username) {
    await page.goto('/');
    await page.click('#tab-register');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'end to end password');
    await page.click('#auth-submit');
    // Two bcrypt hashes and the first map render can take a while on a busy CI runner.
    await expect(page.locator('#main-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#account-name')).toHaveText(username);
}

async function markCity(page, name) {
    await page.fill('#global-search', name);
    await page.locator('#search-results [role="option"]').filter({ hasText: name }).first().click();
    await page.locator('.card-actions button', { hasText: 'Been there' }).last().click();
}

test('a traveler signs up, colors in a city, shares a public map without a hidden place and logs out', async ({ page, browser }) => {
    const errors = trackErrors(page);
    const username = `e2e_${Date.now()}`;
    await signUp(page, username);

    await markCity(page, 'Lisbon');
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // The place survives a reload, so it was persisted through the API.
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#legend-visited')).toHaveText('1');

    // Passport renders progress bars with inline styles; the CSP must allow them.
    await page.click('#tab-passport');
    await expect(page.locator('#passport-tab')).toBeVisible();
    await page.click('#tab-places');
    await expect(page.locator('#places-tab')).toContainText('Lisbon');

    await page.click('#account-btn');
    await page.locator('label.switch').click();
    await expect(page.locator('#copy-share-btn')).toBeEnabled();

    const visitor = await browser.newPage();
    await visitor.route(/wikivoyage\.org/, route => route.abort());
    await visitor.goto(`/?u=${username}`);
    await expect(visitor.locator('#public-view')).toBeVisible();
    await expect(visitor.locator('#public-title')).toContainText(username);
    await expect(visitor.locator('#legend-visited')).toHaveText('1');

    // A place hidden from the public map disappears for visitors, not for its owner.
    await page.keyboard.press('Escape');
    await page.locator('#places-tab').getByRole('button', { name: /Edit Lisbon/ }).click();
    await page.check('#dialog-hideFromPublic');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#places-tab .place')).toContainText('Not on public map');
    await visitor.reload();
    await expect(visitor.locator('#public-view')).toBeVisible();
    await expect(visitor.locator('#legend-visited')).toHaveText('0');
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await visitor.close();

    await page.click('#account-btn');
    await page.click('#logout-btn');
    await expect(page.locator('#welcome-view')).toBeVisible();
    expect(errors).toEqual([]);
});

async function addVisit(page, startDate, endDate = '') {
    await page.locator('.card-popup .visit-add').click();
    await page.fill('#dialog-startDate', startDate);
    if (endDate) await page.fill('#dialog-endDate', endDate);
    await page.getByRole('button', { name: 'Add visit' }).click();
}

test('a traveler records several visits to the same city', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, `e2e_visits_${Date.now()}`);
    await markCity(page, 'Lisbon');
    const card = page.locator('.maplibregl-popup.card-popup');
    await expect(card.locator('.visits-title')).toHaveText('No visits recorded yet');

    await addVisit(page, '2019-06-01', '2019-06-04');
    await expect(card.locator('.visits-title')).toHaveText('Visited once');
    await addVisit(page, '2023-04-01');
    await expect(card.locator('.visits-title')).toHaveText('Visited 2 times');
    // Newest first.
    await expect(card.locator('.visit').first()).toContainText('2023');

    // An end before the start is refused before it reaches the server, keeping what was typed.
    await card.locator('.visit-add').click();
    await page.fill('#dialog-startDate', '2024-01-05');
    await page.fill('#dialog-endDate', '2024-01-01');
    await page.getByRole('button', { name: 'Add visit' }).click();
    await expect(page.locator('.toast-error')).toContainText('on or after');
    await expect(page.locator('#dialog-startDate')).toHaveValue('2024-01-05');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.locator('.visit')).toHaveCount(2);

    await card.locator('.visit').last().getByRole('button', { name: /Remove the visit/ }).click();
    await expect(card.locator('.visits-title')).toHaveText('Visited once');
    await page.locator('.toast', { hasText: 'Removed the visit' }).getByRole('button', { name: 'Undo' }).click();
    await expect(card.locator('.visits-title')).toHaveText('Visited 2 times');

    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await page.click('#tab-places');
    await expect(page.locator('#places-tab .place')).toContainText('2 visits');
    // Filtering goes by the year of the last visit.
    await page.locator('#last-visit-filter').selectOption('none');
    await expect(page.locator('#places-tab')).toContainText('Nothing matches those filters.');
    await page.locator('#last-visit-filter').selectOption('2023');
    await expect(page.locator('#places-tab .place')).toHaveCount(1);
    expect(errors).toEqual([]);
});

// Dates relative to the browser's own today, as the ledger counts them.
function browserDay(page, offset) {
    return page.evaluate(days => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }, offset);
}

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

test('private maps are not shared', async ({ page }) => {
    const username = `e2e_private_${Date.now()}`;
    await signUp(page, username);
    const visitor = await page.context().browser().newPage();
    await visitor.goto(`/?u=${username}`);
    await expect(visitor.locator('.toast-error')).toContainText('Profile not found');
    await expect(visitor.locator('#welcome-view')).toBeVisible();
    await expect(visitor.locator('#public-view')).toBeHidden();
    await visitor.close();
});

test('login errors are shown inline', async ({ page }) => {
    await page.goto('/');
    await page.fill('#auth-username', 'nobody_here');
    await page.fill('#auth-password', 'wrong password');
    await page.click('#auth-submit');
    await expect(page.locator('#auth-error')).toHaveText('Invalid username or password.');
});

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
    expect(errors).toEqual([]);
});

test('a traveler changes their password, then deletes their account', async ({ page }) => {
    const errors = trackErrors(page);
    const username = `e2e_account_${Date.now()}`;
    await signUp(page, username);

    await page.click('#account-btn');
    await page.click('#password-btn');
    await page.fill('#dialog-currentPassword', 'end to end password');
    await page.fill('#dialog-newPassword', 'a brand new password');
    await page.fill('#dialog-confirmPassword', 'a brand new password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Password changed.' })).toBeVisible();

    await page.click('#account-btn');
    await page.click('#logout-btn');
    await page.click('#tab-login');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'a brand new password');
    await page.click('#auth-submit');
    await expect(page.locator('#main-view')).toBeVisible();

    await page.click('#account-btn');
    await page.click('#delete-account-btn');
    await page.fill('#dialog-password', 'a brand new password');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.locator('#welcome-view')).toBeVisible();

    await page.click('#tab-login');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'a brand new password');
    await page.click('#auth-submit');
    await expect(page.locator('#auth-error')).toHaveText('Invalid username or password.');
    expect(errors).toEqual([]);
});

test('towns drawn on the map open their card when clicked', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#welcome-view')).toBeVisible();
    // Zoom to street level around Brussels, then pick a town MapLibre actually drew.
    await page.evaluate(() => globalThis.document.getElementById('map').travelMap.jumpTo({ center: [4.5, 50.8], zoom: 9 }));
    const handle = await page.waitForFunction(() => {
        const map = globalThis.document.getElementById('map').travelMap;
        const { width, height } = map.getCanvas().getBoundingClientRect();
        const town = map.queryRenderedFeatures({ layers: ['cities'] }).find(feature => {
            const point = map.project(feature.geometry.coordinates);
            return point.x > width * 0.45 && point.x < width * 0.9 && point.y > height * 0.2 && point.y < height * 0.8;
        });
        return town && { name: town.properties.name, ...map.project(town.geometry.coordinates) };
    }, null, { timeout: 20_000 });
    const town = await handle.jsonValue();
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + town.x, box.y + town.y);
    await expect(page.locator('.maplibregl-popup.card-popup .card-header h3')).toHaveText(town.name);
});
