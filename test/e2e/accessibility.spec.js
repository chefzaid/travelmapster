'use strict';

const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const { turnOnTwoStep } = require('./helpers');

// WCAG 2.2 level A and AA rules, including colour contrast, in both themes.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page, state) {
    // Audit settled colours: a fade-in such as the dialog's pop-in fails contrast mid-animation.
    await page.evaluate(() => Promise.all(globalThis.document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {}))));
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const summary = results.violations.map(violation =>
        `${violation.id}: ${violation.help} (${violation.nodes.map(node => node.target.join(' ')).slice(0, 5).join(', ')})`);
    expect(summary, `${state} has no WCAG A/AA violations`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
    await page.route(/wikivoyage\.org/, route => route.fulfill({ json: { query: { search: [] } } }));
});

for (const colorScheme of ['light', 'dark']) {
    test(`every screen meets WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
        // One journey audits every screen and dialog, which takes longer than a single flow.
        test.setTimeout(90_000);
        // Reduced motion settles the screen at once: a toast fading out in the middle of an
        // audit would otherwise be measured at half opacity.
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.goto('/');
        await expect(page.locator('#home')).toBeVisible();
        await expect(page.locator('#app[data-map="ready"]')).toBeAttached();
        await expectAccessible(page, 'presentation');
        await page.locator('#home').getByRole('button', { name: 'Explore the demo map' }).first().click();
        await expect(page.locator('#welcome-view')).toBeVisible();
        await expectAccessible(page, 'welcome');

        await page.click('#tab-register');
        await page.fill('#auth-username', `a11y_${colorScheme}_${Date.now()}`);
        await page.fill('#auth-password', 'accessible password');
        await page.click('#auth-submit');
        await expect(page.locator('#main-view')).toBeVisible();

        await page.fill('#global-search', 'Lisbon');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Lisbon' }).first().click();
        await page.locator('.card-actions button', { hasText: 'Been there' }).last().click();
        // Saving re-renders the card; audit the settled card only.
        await expect(page.locator('.maplibregl-popup.card-popup .card-status .chip-visited')).toBeVisible();
        await page.waitForTimeout(500);
        await expect(page.locator('.maplibregl-popup.card-popup')).toHaveCount(1);
        await expectAccessible(page, 'place card');

        await page.locator('.card-popup .visit-add').click();
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'visit dialog');
        await page.fill('#dialog-startDate', '2024-05-01');
        await page.fill('#dialog-endDate', '2024-05-04');
        await page.fill('#dialog-notes', 'Custard tarts by the river');
        await page.getByRole('button', { name: 'Add visit' }).click();
        await expect(page.locator('.card-popup .visit')).toHaveCount(1);
        await page.waitForTimeout(500);
        await expectAccessible(page, 'place card with a visit');

        // Rating, emoji and tags (ADR 0012).
        await page.locator('.card-popup .link-btn', { hasText: 'Edit details' }).click();
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await page.selectOption('#dialog-rating', '5');
        await page.getByRole('button', { name: 'Use 🍜' }).click();
        await page.locator('.choice-chip', { hasText: '#food' }).click();
        await expectAccessible(page, 'place details dialog');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.locator('dialog.dialog')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // A layover and a home country, drawn and listed apart (ADR 0014).
        await page.fill('#global-search', 'Dubai');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Dubai' }).first().click();
        await page.locator('.card-actions button', { hasText: 'Transit only' }).click();
        await expect(page.locator('.maplibregl-popup.card-popup .card-status .chip-transit')).toBeVisible();
        await page.waitForTimeout(500);
        await expectAccessible(page, 'transit place card');
        await page.keyboard.press('Escape');
        await page.click('#account-btn');
        await page.click('#settings-btn');
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await page.selectOption('#dialog-homeCountry', 'PRT');
        await expectAccessible(page, 'settings dialog');
        await page.getByRole('button', { name: 'Save settings' }).click();
        await expect(page.locator('dialog.dialog')).toHaveCount(0);
        // Sign-in security, and the QR code that turns on two-step sign-in (ADR 0027).
        await page.click('#account-btn');
        await page.click('#security-btn');
        await expect(page.locator('dialog.dialog', { hasText: 'Sign-in security' })).toBeVisible();
        await expectAccessible(page, 'sign-in security dialog');
        await page.locator('dialog.dialog').getByRole('button', { name: 'Turn on' }).click();
        await expect(page.locator('dialog.dialog img.qr-code')).toBeVisible();
        await expectAccessible(page, 'two-step setup dialog');
        await page.locator('dialog.dialog').getByRole('button', { name: 'Cancel' }).click();
        await turnOnTwoStep(page);
        await expect(page.locator('dialog.dialog')).toHaveCount(0);
        // An organization with a rule, its report, and the rule in the Ledger tab (ADR 0029).
        await page.click('#account-btn');
        await page.click('#orgs-btn');
        await page.getByRole('button', { name: '＋ Create an organization' }).click();
        await page.fill('#dialog-name', 'Audit Co');
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(page.locator('dialog.dialog .dialog-item', { hasText: 'Audit Co' })).toBeVisible();
        await expectAccessible(page, 'organizations dialog');
        await page.getByRole('button', { name: 'Manage Audit Co' }).click();
        await page.getByRole('button', { name: '＋ Stay rule' }).click();
        await page.fill('#dialog-name', 'Audit visa');
        await page.fill('#dialog-countries', 'Japan');
        await page.getByRole('button', { name: 'Add rule' }).click();
        await page.getByRole('button', { name: 'Show business days' }).click();
        await expect(page.locator('.org-report')).toBeVisible();
        await expectAccessible(page, 'organization report');
        await page.getByRole('button', { name: 'Back' }).click();
        await page.locator('dialog.dialog').getByRole('button', { name: 'Done' }).click();
        await expect(page.locator('dialog.dialog')).toHaveCount(0);

        for (const tab of ['explore', 'places', 'ledger', 'trips', 'passport']) {
            await page.click(`#tab-${tab}`);
            await expect(page.locator(`#${tab}-tab`)).toBeVisible();
            await expectAccessible(page, `${tab} tab`);
        }

        // A tag filter narrows the list and the map, and the legend offers to clear it.
        await page.click('#tab-places');
        await page.selectOption('#tag-filter', 'food');
        await expect(page.locator('#legend-detail-filter')).toBeVisible();
        await expectAccessible(page, 'places filtered by tag');
        await page.click('#legend-detail-filter');
        await expect(page.locator('#legend-detail-filter')).toBeHidden();

        // Picking countries on the map to mark them at once.
        await page.click('#bulk-pick');
        await page.fill('#global-search', 'Peru');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Peru' }).first().click();
        await expect(page.locator('#select-count')).toHaveText('1 country selected');
        await expectAccessible(page, 'country picking bar');
        await page.click('#select-cancel');
        await expect(page.locator('#select-bar')).toBeHidden();

        // Day ledger: a rule dialog and the printable evidence report.
        await page.click('#tab-ledger');
        await page.getByRole('button', { name: '＋ Add a threshold' }).click();
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'threshold dialog');
        await page.getByRole('button', { name: 'Cancel' }).click();
        await page.fill('#report-from', '2024-01-01');
        await page.getByRole('button', { name: /View report/ }).click();
        await expect(page.locator('#report-view tbody tr').nth(3)).toBeVisible();
        await expectAccessible(page, 'evidence report');
        await page.locator('#report-view').getByRole('button', { name: 'Close' }).click();

        // A yearly goal: its dialog, then the passport with it.
        await page.click('#tab-passport');
        await page.getByRole('button', { name: '＋ Set a goal' }).click();
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'goal dialog');
        await page.getByRole('button', { name: 'Set goal' }).click();
        await expect(page.locator('#goals .ledger-item')).toHaveCount(1);
        await expectAccessible(page, 'passport with a goal');

        // A trip and its printable itinerary.
        await page.click('#tab-trips');
        await page.getByRole('button', { name: 'Plan my first trip' }).click();
        await page.getByLabel('Where to?').fill('Lisbon');
        await page.getByRole('button', { name: 'Create trip' }).click();
        await expect(page.locator('#trips-tab .day-card')).toHaveCount(3);
        await expectAccessible(page, 'trip editor');
        await page.locator('#trips-tab').getByRole('button', { name: '🖨️ Print' }).click();
        await expect(page.locator('#report-view tbody tr')).toHaveCount(3);
        await expectAccessible(page, 'printable itinerary');
        await page.locator('#report-view').getByRole('button', { name: 'Close' }).click();

        await page.click('#account-btn');
        await expectAccessible(page, 'account menu');
        await page.click('#password-btn');
        await expect(page.locator('dialog.dialog')).toBeVisible();
        await expectAccessible(page, 'change password dialog');
    });
}

// Saves places and settings through the API, as the app does.
async function seed(page, places, profile) {
    await page.evaluate(async ({ list, settings }) => {
        const { csrfToken } = await (await fetch('/api/csrf-token')).json();
        const send = (method, path, body) => fetch(path, {
            method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body)
        });
        for (const place of list) await send('POST', '/api/markers', place);
        await send('PATCH', '/api/profile', settings);
    }, { list: places, settings: profile });
    await page.reload();
    await page.locator('#main-view').waitFor();
}

for (const colorScheme of ['light', 'dark']) {
    test(`the timeline, map palettes and a public map meet WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        const username = `a11y_map_${colorScheme}_${Date.now()}`;
        await page.goto('/#sign-up');
        await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
        await page.click('#tab-register');
        await page.fill('#auth-username', username);
        await page.fill('#auth-password', 'accessible password');
        await page.click('#auth-submit');
        // Two bcrypt hashes can take a while on a busy runner.
        await expect(page.locator('#main-view')).toBeVisible({ timeout: 15_000 });
        await seed(page, [
            { name: 'Lisbon, Portugal', lat: 38.725, lng: -9.15, category: 'City', type: 'visited', emoji: '🐟', visits: [{ startDate: '2024-05-01', endDate: '2024-05-04' }] },
            { name: 'Madrid, Spain', lat: 40.417, lng: -3.704, category: 'City', type: 'visited', visits: [{ startDate: '2024-05-05', endDate: '2024-05-08' }] },
            { name: 'Berlin, Germany', lat: 52.52, lng: 13.405, category: 'City', type: 'visited', stay: 'lived', visits: [{ startDate: '2020-01-01', endDate: '2022-12-31' }] },
            { name: 'Dubai, United Arab Emirates', lat: 25.205, lng: 55.271, category: 'City', type: 'visited', stay: 'transit', visits: [{ startDate: '2024-05-09' }] },
            { name: 'Peru', lat: -9.2, lng: -75, category: 'Country', type: 'wishlist' }
        ], { homeCountry: 'CAN', profileVisibility: 'public', publicJourneys: true });

        // The timeline with journey lines, after a replay.
        await page.click('#timeline-btn');
        await page.locator('.time-journeys .switch').click();
        await page.click('#journey-replay');
        await expect(page.locator('#journey-now')).toContainText('Replay finished');
        await page.locator('.time-modes label', { hasText: 'Visited during' }).click();
        await expect(page.locator('#time-summary')).toContainText('During 2024');
        await expectAccessible(page, 'timeline after a replay');
        await page.click('#time-close');
        await expect(page.locator('#time-bar')).toBeHidden();

        // Every palette keeps cards, chips, pins, stamps and the legend at AA.
        for (const palette of ['colorblind', 'print']) {
            await page.click('#account-btn');
            await page.click('#settings-btn');
            await page.selectOption('#dialog-mapPalette', palette);
            await page.getByRole('button', { name: 'Save settings' }).click();
            await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
            await page.locator('.pin[aria-label^="Lisbon"]').click();
            await expect(page.locator('.maplibregl-popup.card-popup .card-status .chip-visited')).toBeVisible();
            await page.waitForTimeout(500);
            await expectAccessible(page, `place card in the ${palette} palette`);
            await page.keyboard.press('Escape');
            // The passport's tiles, stamps and bars use the most palette colors.
            await page.click('#tab-passport');
            await expect(page.locator('#passport-tab')).toBeVisible();
            await expectAccessible(page, `passport in the ${palette} palette`);
        }

        // A visitor's public map, with its own palette choice and the timeline.
        await page.goto(`/?u=${username}`);
        await expect(page.locator('#public-view')).toBeVisible();
        await page.selectOption('#public-palette', 'colorblind');
        await page.click('#timeline-btn');
        await expect(page.locator('#time-journeys')).toBeVisible();
        await expectAccessible(page, 'public map with the timeline');

        // The same map embedded in another site.
        await page.goto(`/embed/${username}`);
        await expect(page.locator('#embed-stats')).toContainText('countr');
        await expectAccessible(page, 'embeddable map');
    });
}

for (const colorScheme of ['light', 'dark']) {
    test(`public pages meet WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        // Landing page with a demo place card open.
        await page.goto('/');
        await page.locator('#home').getByRole('button', { name: 'Explore the demo map' }).first().click();
        await expect(page.locator('#demo-ledger')).toContainText('Schengen days');
        await page.fill('#global-search', 'Lisbon');
        await page.locator('#search-results [role="option"]').filter({ hasText: 'Lisbon' }).first().click();
        await expect(page.locator('.maplibregl-popup.card-popup .card-status .chip-visited')).toBeVisible();
        await page.waitForTimeout(500);
        await expectAccessible(page, 'demo place card');

        // The Schengen calculator with a result, an overstay and a faulty row.
        await page.goto('/schengen-calculator');
        await expectAccessible(page, 'empty calculator');
        await page.fill('#stay-1-entry', '2026-01-01');
        await page.fill('#stay-1-exit', '2026-04-30');
        await page.click('#add-stay');
        await page.fill('#stay-2-entry', '2026-06-01');
        await page.fill('#stay-2-exit', '2026-05-01');
        await page.fill('#check-date', '2026-03-01');
        await expect(page.locator('.overstay')).toBeVisible();
        await expect(page.locator('#stay-2-error')).toBeVisible();
        await expectAccessible(page, 'calculator with an overstay');
    });
}
