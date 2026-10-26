'use strict';

// The map itself: towns drawn at street level, and the timeline with journey lines and palettes.
const { test, expect } = require('@playwright/test');
const { addPlaces, journeyLineCount, signUp, stubThirdParties, trackErrors } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('towns drawn on the map open their card when clicked', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
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
