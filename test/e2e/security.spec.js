'use strict';

// Sign-in security (ADR 0027): a passkey made with Chromium's virtual authenticator, and
// two-step sign-in with codes computed like an authenticator app's.
const { test, expect } = require('@playwright/test');
const { signUp, stubThirdParties, trackErrors } = require('./helpers');
const totp = require('../../src/totp');

test.beforeEach(({ page }) => stubThirdParties(page));

test('a traveler adds a passkey and two-step sign-in, then signs in with each', async ({ page, baseURL }) => {
    const errors = trackErrors(page);
    // Passkeys need a domain name: the same server, as localhost.
    const origin = `http://localhost:${new URL(baseURL).port}`;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
    });

    const username = `e2e_keys_${Date.now()}`;
    await page.goto(`${origin}/#sign-up`);
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'end to end password');
    await page.click('#auth-submit');
    await expect(page.locator('#main-view')).toBeVisible({ timeout: 15_000 });

    // A passkey, created by the device.
    await page.click('#account-btn');
    await page.click('#security-btn');
    const security = page.locator('dialog.dialog', { hasText: 'Sign-in security' });
    await security.getByRole('button', { name: '＋ Add a passkey' }).click();
    await page.fill('#dialog-name', 'Test laptop');
    await page.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page.locator('.toast-success', { hasText: 'Passkey added' })).toBeVisible();
    await expect(security.locator('.passkey')).toContainText('Test laptop');

    // Two-step sign-in, from the key shown beside the QR code.
    await security.getByRole('button', { name: 'Turn on' }).click();
    const setup = page.locator('dialog.dialog', { hasText: 'Turn on two-step sign-in' });
    await expect(setup.locator('img.qr-code')).toBeVisible();
    const secret = (await setup.locator('.two-step-key').textContent()).replace(/\s/g, '');
    const code = offset => totp.hotp(totp.base32Decode(secret), Math.floor(Date.now() / 30_000) + offset);
    await page.fill('#dialog-code', code(0));
    await setup.getByRole('button', { name: 'Turn on' }).click();
    const codes = page.locator('dialog.dialog', { hasText: 'Save your recovery codes' });
    await expect(codes.locator('.recovery-codes li')).toHaveCount(10);
    await codes.getByRole('button', { name: 'I saved them' }).click();
    await expect(security).toContainText('10 recovery codes left');
    await security.getByRole('button', { name: 'Done' }).click();

    // The password now asks for a code.
    await page.click('#account-btn');
    await page.click('#logout-btn');
    await page.click('#tab-login');
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', 'end to end password');
    await page.click('#auth-submit');
    await expect(page.locator('#second-step-form')).toBeVisible();
    await page.fill('#second-step-code', '000000');
    await page.click('#second-step-submit');
    await expect(page.locator('#second-step-error')).toContainText('not right');
    await page.fill('#second-step-code', code(1));
    await page.click('#second-step-submit');
    await expect(page.locator('#main-view')).toBeVisible();

    // The passkey signs in alone.
    await page.click('#account-btn');
    await page.click('#logout-btn');
    await page.click('#tab-login');
    await page.getByRole('button', { name: '🔑 Log in with a passkey' }).click();
    await expect(page.locator('#main-view')).toBeVisible();
    await expect(page.locator('#account-name')).toHaveText(username);
    expect(errors).toEqual([]);
});

test('a traveler sees the devices signed in and signs another one out', async ({ page, browser }) => {
    const errors = trackErrors(page);
    const username = `e2e_devices_${Date.now()}`;
    await signUp(page, username);
    // The same account on a phone.
    const phone = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
    const phonePage = await phone.newPage();
    await stubThirdParties(phonePage);
    await phonePage.goto('/#log-in');
    await expect(phonePage.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    await phonePage.fill('#auth-username', username);
    await phonePage.fill('#auth-password', 'end to end password');
    await phonePage.click('#auth-submit');
    await expect(phonePage.locator('#main-view')).toBeVisible({ timeout: 15_000 });

    await page.click('#account-btn');
    await page.click('#security-btn');
    const devices = page.locator('#sessions li');
    await expect(devices).toHaveCount(2);
    await expect(devices.filter({ hasText: 'This device' })).toHaveCount(1);
    await expect(devices.filter({ hasText: 'Chrome on Android' })).toHaveCount(1);
    // The phone's sign-in is in the activity.
    await expect(page.locator('#security-activity li').first()).toContainText('Signed in with the password');
    await expect(page.locator('#security-activity li').first()).toContainText('Chrome on Android');
    await page.getByRole('button', { name: 'Sign out Chrome on Android' }).click();
    await expect(page.locator('.toast', { hasText: 'Signed out Chrome on Android.' })).toBeVisible();
    await expect(devices).toHaveCount(1);
    await phonePage.reload();
    await expect(phonePage.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    await phone.close();
    expect(errors).toEqual([]);
});
