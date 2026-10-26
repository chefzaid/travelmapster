'use strict';

// Journeys of a traveler: signing up, places and visits, marking many countries, home and stays, sharing.
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { addVisit, browserDay, markCity, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

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
    // A posted link shows the map's own preview; its picture is a PNG of the map.
    await expect(visitor).toHaveTitle(`${username}'s travel map · TravelMapster`);
    const preview = await visitor.locator('meta[property="og:image"]').getAttribute('content');
    const picture = await visitor.request.get(preview);
    expect(picture.headers()['content-type']).toBe('image/png');
    await expect(visitor.getByRole('link', { name: 'Make your own map' })).toBeVisible();

    // The embeddable map shows in another site's frame, and nothing at all for a private map.
    await expect(page.locator('#embed-btn')).toBeEnabled();
    await visitor.setContent(`<iframe src="${new URL(`/embed/${username}`, page.url()).href}" title="map" width="640" height="420"></iframe>`);
    const frame = visitor.frameLocator('iframe');
    await expect(frame.locator('#embed-title')).toHaveText(`${username}'s travel map`);
    await expect(frame.locator('#embed-stats')).toHaveText('1 country, 1 city');
    await expect(frame.locator('#embed-link')).toHaveAttribute('href', `/?u=${username}`);
    await visitor.goto('/embed/nobody_by_that_name');
    await expect(visitor.locator('#embed-stats')).toHaveText('This map is private, or does not exist.');

    // A place hidden from the public map disappears for visitors, not for its owner.
    await page.keyboard.press('Escape');
    await page.locator('#places-tab').getByRole('button', { name: /Edit Lisbon/ }).click();
    await page.check('#dialog-hideFromPublic');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#places-tab .place')).toContainText('Not on public map');
    await visitor.goto(`/?u=${username}`);
    await expect(visitor.locator('#public-view')).toBeVisible();
    await expect(visitor.locator('#legend-visited')).toHaveText('0');
    await expect(page.locator('#legend-visited')).toHaveText('1');
    await visitor.close();

    await page.click('#account-btn');
    await page.click('#logout-btn');
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    expect(errors).toEqual([]);
});

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

    // A picture of the year's recap, as a square PNG.
    const picture = page.waitForEvent('download');
    await page.locator('#share-pictures').getByRole('button', { name: /recap/ }).click();
    const png = fs.readFileSync(await (await picture).path());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
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
    // South America's 14 territories (French Guiana among them) but Peru.
    await expect(page.locator('#legend-wishlist')).toHaveText('13');
    expect(requests).toBe(3);
    await page.reload();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#legend-wishlist')).toHaveText('13');

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
    // Berlin, lived in, is a capital; Dubai, a layover, is not.
    await expect(page.locator('#collections [role="progressbar"]').first()).toHaveAttribute('aria-valuenow', '1');
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

test('private maps are not shared', async ({ page }) => {
    const username = `e2e_private_${Date.now()}`;
    await signUp(page, username);
    const visitor = await page.context().browser().newPage();
    await visitor.goto(`/?u=${username}`);
    await expect(visitor.locator('.toast-error')).toContainText('Profile not found');
    await expect(visitor.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
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
