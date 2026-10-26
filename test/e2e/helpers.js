'use strict';

// Shared steps of the browser journeys: signing up, marking places, adding visits and dates
// relative to the browser's today.
const { expect } = require('@playwright/test');
const totp = require('../../src/totp');

/** Keeps tests hermetic: no third-party guide lookups. */
function stubThirdParties(page) {
    return page.route(/wikivoyage\.org/, route => route.fulfill({ json: { query: { search: [] } } }));
}

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

/** Opens the demo map from the presentation that visitors see first. */
async function openDemo(page) {
    await page.goto('/');
    await page.locator('#home').getByRole('button', { name: 'Explore the demo map' }).first().click();
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
}

async function signUp(page, username) {
    // A sign-up link skips the presentation; the form is ready once the landing panel shows.
    await page.goto('/#sign-up');
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
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

async function addVisit(page, startDate, endDate = '') {
    await page.locator('.card-popup .visit-add').click();
    await page.fill('#dialog-startDate', startDate);
    if (endDate) await page.fill('#dialog-endDate', endDate);
    await page.getByRole('button', { name: 'Add visit' }).click();
}

/** Turns on two-step sign-in in the open Sign-in security dialog, with a code computed like an app's. */
async function turnOnTwoStep(page) {
    const security = page.locator('dialog.dialog', { hasText: 'Sign-in security' });
    await security.getByRole('button', { name: 'Turn on' }).click();
    const setup = page.locator('dialog.dialog', { hasText: 'Turn on two-step sign-in' });
    const secret = (await setup.locator('.two-step-key').textContent()).replace(/\s/g, '');
    await page.fill('#dialog-code', totp.hotp(totp.base32Decode(secret), Math.floor(Date.now() / 30_000)));
    await setup.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('button', { name: 'I saved them' }).click();
    await expect(security).toContainText('recovery codes left');
    await security.getByRole('button', { name: 'Done' }).click();
}

// Dates relative to the browser's own today, as the ledger counts them.
function browserDay(page, offset) {
    return page.evaluate(days => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }, offset);
}

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

module.exports = { addPlaces, addVisit, browserDay, journeyLineCount, markCity, openDemo, signUp, stubThirdParties, trackErrors, turnOnTwoStep };
