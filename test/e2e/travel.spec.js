'use strict';

const fs = require('node:fs');
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
    // The form is ready once the landing page shows.
    await expect(page.locator('#welcome-view')).toBeVisible();
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
    await page.locator('label.switch', { hasText: 'Public travel map' }).click();
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

    // A visit that began on this day four years ago (a leap year whenever today is one) comes
    // back on the Explore tab and shows its place.
    const today = await browserDay(page, 0);
    await page.fill('#global-search', 'Lisbon');
    await page.locator('#search-results [role="option"]').filter({ hasText: 'Lisbon' }).first().click();
    await addVisit(page, `${Number(today.slice(0, 4)) - 4}${today.slice(4)}`);
    await expect(card.locator('.visits-title')).toHaveText('Visited 3 times');
    await page.click('#tab-explore');
    await expect(page.locator('#memories')).toContainText('4 years ago today, you arrived in Lisbon');
    await page.locator('#memories button').click();
    await expect(card.locator('h3')).toHaveText('Lisbon');

    // The passport sums the dated visits up.
    await page.click('#tab-passport');
    const travel = page.locator('#travel-stats');
    await expect(travel.locator('.stat', { hasText: 'longest trip' })).toContainText('4');
    await expect(travel).toContainText('Longest trip: Lisbon');
    await expect(travel).toContainText('Set a home country');
    await expect(page.locator('#passport-tab')).toContainText('Countries by year');

    // A goal already met is celebrated at once; it can be removed again.
    await page.getByRole('button', { name: '＋ Set a goal' }).click();
    await page.fill('#dialog-target', '1');
    await page.selectOption('#dialog-kind', 'cities');
    await page.fill('#dialog-year', '2019');
    await page.getByRole('button', { name: 'Set goal' }).click();
    await expect(page.locator('.toast', { hasText: 'Goal reached: 1 new city in 2019!' })).toBeVisible();
    await expect(page.locator('#goals')).toContainText('Reached: 1 of 1');
    await page.getByRole('button', { name: 'Remove the goal 1 new city in 2019' }).click();
    await expect(page.locator('#goals .ledger-item')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a traveler marks several countries and a whole continent at once, with undo', async ({ page }) => {
    // Recoloring a whole continent several times is slow on a busy runner without a GPU.
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await signUp(page, `e2e_bulk_${Date.now()}`);
    let requests = 0;
    page.on('request', request => { if (request.url().includes('/api/markers/bulk')) requests += 1; });

    await page.click('#tab-places');
    await page.click('#bulk-pick');
    for (const name of ['France', 'Spain', 'Italy']) {
        await page.fill('#global-search', name);
        await page.locator('#search-results [role="option"]').filter({ hasText: name }).first().click();
    }
    await expect(page.locator('#select-count')).toHaveText('3 countries selected');
    await page.locator('#select-bar').getByRole('button', { name: 'Been there' }).click();
    await expect(page.locator('#legend-visited')).toHaveText('3');
    await expect(page.locator('#select-bar')).toBeHidden();
    expect(requests).toBe(1);

    await page.locator('.toast', { hasText: 'Marked 3 countries' }).getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#legend-visited')).toHaveText('0');
    expect(requests).toBe(2);

    // A whole continent in one step; a wishlist leaves visited countries alone.
    await markCity(page, 'Lima');
    await page.click('#tab-places');
    await page.locator('#bulk-continent').selectOption('South America');
    await page.locator('.bulk-section').getByRole('button', { name: 'Wishlist' }).click();
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await expect(page.locator('#legend-wishlist')).toHaveText('12');
    expect(requests).toBe(3);
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#legend-wishlist')).toHaveText('12');

    // A wishlist place starts a trip plan from the list.
    await page.click('#tab-places');
    await page.getByRole('button', { name: 'Plan a trip to Brazil' }).click();
    await expect(page.getByLabel('Where to?')).toHaveValue('Brazil');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(errors).toEqual([]);
});

test('a traveler sets a home country, a city lived in, a layover and the UN list, and the passport counts them apart', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await signUp(page, `e2e_home_${Date.now()}`);

    await page.click('#account-btn');
    await page.click('#settings-btn');
    await page.selectOption('#dialog-homeCountry', 'CAN');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await expect(page.locator('#legend-home')).toBeAttached();

    for (const [name, status] of [['Berlin', 'Lived there'], ['Dubai', 'Transit only']]) {
        await page.fill('#global-search', name);
        await page.locator('#search-results [role="option"]').filter({ hasText: name }).first().click();
        await page.locator('.card-actions button', { hasText: status }).click();
        await expect(page.locator('.card-popup .card-actions button', { hasText: status })).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.locator('.card-popup .visits-title')).toHaveText('No layovers recorded yet');
    await page.keyboard.press('Escape');
    await expect(page.locator('#legend-visited')).toHaveText('2');
    await expect(page.locator('#legend-lived')).toHaveText('2');
    await expect(page.locator('#legend-transit')).toHaveText('1');

    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#legend-transit')).toHaveText('1');
    await page.click('#tab-passport');
    await expect(page.locator('.passport-home')).toContainText('Canada');
    await expect(page.locator('.stamp', { hasText: 'Germany' })).toContainText('Lived');
    await expect(page.locator('.stamp')).toHaveCount(2);
    await expect(page.locator('#passport-tab')).toContainText('Transit only, not counted: United Arab Emirates.');
    await page.click('#tab-places');
    await page.locator('.filter-chip', { hasText: 'Transit' }).click();
    await expect(page.locator('#places-tab .place')).toHaveCount(1);
    await expect(page.locator('#places-tab .place')).toContainText('Dubai');

    // Counting UN members and observers leaves Kosovo out, but the map keeps it (ADR 0015).
    await markCity(page, 'Pristina');
    await expect(page.locator('#legend-visited')).toHaveText('3');
    await page.keyboard.press('Escape');
    await page.click('#account-btn');
    await page.click('#settings-btn');
    await page.selectOption('#dialog-countryList', 'un');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('#legend-visited')).toHaveText('2');
    await page.click('#tab-passport');
    await expect(page.locator('#passport-tab')).toContainText('of UN countries');
    await expect(page.locator('#passport-tab')).toContainText('not on the UN countries list: Kosovo.');
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

test('a traveler changes their password, downloads all their data, then deletes their account', async ({ page }) => {
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

    // Before leaving, the whole account goes into one archive, and places into map formats.
    await markCity(page, 'Lisbon');
    await page.keyboard.press('Escape');
    await page.click('#account-btn');
    const archive = page.waitForEvent('download');
    await page.click('#export-btn');
    const download = await archive;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^travelmapster-${username}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
    const zip = fs.readFileSync(await download.path());
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(zip.toString('utf8')).toContain('"format": "travelmapster-account"');
    expect(zip.toString('utf8')).toContain('<name>Lisbon, Portugal</name>');
    await page.click('#tab-places');
    const kml = page.waitForEvent('download');
    await page.getByRole('button', { name: '⬇️ KML' }).click();
    expect((await kml).suggestedFilename()).toMatch(/^travelmapster-places-.*\.kml$/);
    await expect(page.locator('#places-tab')).toContainText('Exported 1 place as KML.');

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

// Saves places with their visits through the API, as the app does, then reloads the map.
async function addPlaces(page, places) {
    await page.evaluate(async list => {
        const { csrfToken } = await (await fetch('/api/csrf-token')).json();
        for (const place of list) {
            const response = await fetch('/api/markers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify(place)
            });
            if (!response.ok) throw new Error(`Saving ${place.name}: ${response.status}`);
        }
    }, places);
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
}

const journeyLineCount = page => page.evaluate(async () =>
    (await globalThis.document.getElementById('map').travelMap.getSource('journeys').getData()).features.length);

test('a traveler replays their map year by year with journey lines, picks map colors and prints it', async ({ page, browser }) => {
    const errors = trackErrors(page);
    const username = `e2e_years_${Date.now()}`;
    await signUp(page, username);
    await addPlaces(page, [
        { name: 'Germany', lat: 51, lng: 10, category: 'Country', type: 'visited', stay: 'lived', visits: [{ startDate: '2015-01-01', endDate: '2018-06-30' }] },
        { name: 'Lisbon, Portugal', lat: 38.725, lng: -9.15, category: 'City', type: 'visited', visits: [{ startDate: '2019-05-01', endDate: '2019-05-05' }] },
        { name: 'Madrid, Spain', lat: 40.417, lng: -3.704, category: 'City', type: 'visited', visits: [{ startDate: '2019-05-06', endDate: '2019-05-09' }] },
        { name: 'Dubai, United Arab Emirates', lat: 25.205, lng: 55.271, category: 'City', type: 'visited', stay: 'transit', visits: [{ startDate: '2023-03-31' }] },
        { name: 'Japan', lat: 36.2, lng: 138.25, category: 'Country', type: 'visited', visits: [{ startDate: '2023-04-01', endDate: '2023-04-12' }] },
        { name: 'Italy', lat: 42.8, lng: 12.5, category: 'Country', type: 'visited' }
    ]);
    await expect(page.locator('#legend-visited')).toHaveText('5');

    // The timeline opens on the year of the latest visit, with the range in keyboard focus.
    await page.click('#timeline-btn');
    const summary = page.locator('#time-summary');
    await expect(page.locator('#time-year')).toBeFocused();
    await expect(page.locator('#time-year-value')).toHaveText('2023');
    await expect(summary).toHaveText('By the end of 2023: 4 countries been to. 1 place without dates is not shown.');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await expect(summary).toContainText('By the end of 2019: 3 countries been to.');
    await expect(page.locator('.pin[aria-label^="Lisbon"]')).toHaveCount(1);
    await expect(page.locator('.pin[aria-label^="Dubai"]')).toHaveCount(0);
    await page.keyboard.press('Home');
    await expect(summary).toContainText('By the end of 2015: 1 country been to.');

    // Visited during a year, with the journey lines between its visits.
    await page.locator('.time-modes label', { hasText: 'Visited during' }).click();
    await expect(summary).toContainText('During 2015: 1 country visited.');
    await page.locator('#time-year').focus();
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
    await expect(summary).toContainText('During 2019: 2 countries visited.');
    await expect.poll(() => journeyLineCount(page)).toBe(0);
    await page.locator('.time-journeys .switch').click();
    await expect.poll(() => journeyLineCount(page)).toBe(1);
    await expect(page.locator('#journey-pick option')).toHaveText(['Every journey in 2019', /Lisbon → Madrid/]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#journey-replay');
    await expect(page.locator('#journey-now')).toHaveText('Replay finished: Lisbon → Madrid.');

    // A color-blind safe palette, saved with the account, recolors the map.
    await page.click('#account-btn');
    await page.click('#settings-btn');
    await page.selectOption('#dialog-mapPalette', 'colorblind');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'colorblind');
    await expect.poll(() => page.evaluate(() =>
        globalThis.document.getElementById('map').travelMap.getPaintProperty('borders-visited', 'line-color'))).toBe('#005a8c');

    // Visitors of the public map get journey lines only once the owner shares them.
    await page.click('#account-btn');
    await page.locator('label.switch', { hasText: 'Public travel map' }).click();
    await expect(page.locator('#copy-share-btn')).toBeEnabled();
    await page.keyboard.press('Escape');
    const visitor = await browser.newPage();
    await visitor.route(/wikivoyage\.org/, route => route.abort());
    await visitor.goto(`/?u=${username}`);
    await expect(visitor.locator('#public-view')).toBeVisible();
    await visitor.click('#timeline-btn');
    await expect(visitor.locator('#time-summary')).toContainText('By the end of 2023: 4 countries been to.');
    await expect(visitor.locator('#time-journeys')).toBeHidden();
    await page.click('#account-btn');
    await page.click('#settings-btn');
    await page.check('#dialog-publicJourneys');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save settings' }).click();
    expect((await saved).ok()).toBe(true);
    await visitor.reload();
    await visitor.click('#timeline-btn');
    await expect(visitor.locator('#time-journeys')).toBeVisible();
    await expect(visitor.locator('html')).not.toHaveAttribute('data-palette', /./);
    await visitor.close();

    // Printing draws the map as shown, with a title, and hides the controls.
    await page.evaluate(() => { globalThis.print = () => { globalThis.printed = true; }; });
    await page.click('#account-btn');
    await page.click('#print-btn');
    await page.waitForFunction(() => globalThis.printed);
    await expect(page.locator('#map-print')).toHaveAttribute('src', /^data:image\/png/);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-sheet')).toBeVisible();
    await expect(page.locator('#print-title')).toHaveText(`${username}'s travel map, places visited during 2019`);
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('#time-bar')).toBeHidden();
    expect(errors).toEqual([]);
});
