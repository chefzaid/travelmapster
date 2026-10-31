'use strict';

// Organizations (ADR 0029): an admin sets a rule and invites a traveler by link; the traveler
// marks a business trip, sees the rule in the Ledger tab and who looked at their days.
const { test, expect } = require('@playwright/test');
const { browserDay, markCity, signUp, stubThirdParties, trackErrors, turnOnTwoStep } = require('./helpers');

test.beforeEach(({ page }) => stubThirdParties(page));

test('an admin invites a traveler, whose business days count against the employer\'s rule', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    const stamp = Date.now();
    const boss = `e2e_boss_${stamp}`;
    const worker = `e2e_worker_${stamp}`;
    const orgName = `Globex ${stamp}`;
    await signUp(page, boss);

    // The admin creates the organization, once two-step sign-in is on, then a rule and an
    // invitation link.
    await page.click('#account-btn');
    await page.click('#orgs-btn');
    const create = async () => {
        await page.getByRole('button', { name: '＋ Create an organization' }).click();
        await page.fill('#dialog-name', orgName);
        await page.getByRole('button', { name: 'Create', exact: true }).click();
    };
    await create();
    await page.getByRole('button', { name: 'Open sign-in security' }).click();
    await turnOnTwoStep(page);
    await page.click('#account-btn');
    await page.click('#orgs-btn');
    await create();
    const orgs = page.locator('dialog.dialog', { hasText: 'Who looked at your days' });
    await expect(orgs.locator('.dialog-item', { hasText: orgName })).toContainText('Admin · 0 rules');
    await orgs.getByRole('button', { name: `Manage ${orgName}` }).click();
    const manage = page.locator('dialog.dialog', { hasText: 'Business days' });
    await manage.getByRole('button', { name: '＋ Threshold' }).click();
    await page.fill('#dialog-name', 'Portugal A1');
    await page.fill('#dialog-countries', 'Portugal');
    await page.fill('#dialog-maxDays', '5');
    await page.locator('#dialog-period').selectOption('rolling');
    await page.getByRole('button', { name: 'Add rule' }).click();
    await expect(manage.locator('.dialog-item', { hasText: 'Portugal A1' })).toContainText('5 days in any 365 days · Portugal');
    await manage.getByRole('button', { name: '＋ Invite someone' }).click();
    await page.getByRole('button', { name: 'Make the link' }).click();
    const link = await page.locator('.invitation-link').textContent();
    expect(link).toMatch(/\/#join=[\w-]{32}$/);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(manage.locator('#org-invitations-title + .dialog-list')).toContainText('Role: Traveler');

    // The traveler opens the link signed out, signs up and agrees to join.
    const other = await browser.newPage();
    await stubThirdParties(other);
    const otherErrors = trackErrors(other);
    await other.goto(link.slice(link.indexOf('/#join=')));
    await expect(other.locator('#app[data-map="ready"] #welcome-view')).toBeVisible();
    await expect(other.locator('.toast', { hasText: 'to join the organization' })).toBeVisible();
    await other.click('#tab-register');
    await other.fill('#auth-username', worker);
    await other.fill('#auth-password', 'end to end password');
    await other.click('#auth-submit');
    await other.getByRole('button', { name: 'Join', exact: true }).click();
    const joined = other.locator('dialog.dialog', { hasText: 'Who looked at your days' });
    await expect(joined.locator('.dialog-item', { hasText: orgName })).toContainText('Traveler · 1 rule');
    await expect(joined.getByRole('button', { name: `Manage ${orgName}` })).toHaveCount(0);
    await joined.getByRole('button', { name: 'Done' }).click();

    // Six days in Lisbon for work: over the five the employer allows.
    await markCity(other, 'Lisbon');
    await other.locator('.card-popup .visit-add').click();
    await other.fill('#dialog-startDate', await browserDay(other, -6));
    await other.fill('#dialog-endDate', await browserDay(other, -1));
    await other.locator('#dialog-purpose').selectOption({ label: `Business: ${orgName}` });
    await other.getByRole('button', { name: 'Add visit' }).click();
    await expect(other.locator('.card-popup .visit')).toContainText(`💼 Business: ${orgName}`);
    await other.keyboard.press('Escape');
    await other.click('#tab-ledger');
    const section = other.locator('#ledger-tab section', { hasText: `💼 ${orgName}` });
    await expect(section).toContainText('Portugal A1');
    await expect(section).toContainText('⛔ Reached');
    await expect(section).toContainText('6 of 5 days');

    // A business trip back to Lisbon in ten days, planned with the organization.
    const start = await browserDay(other, 10);
    await other.evaluate(async ({ startDate, orgName: name }) => {
        const { csrfToken } = await (await fetch('/api/csrf-token')).json();
        const send = (method, url, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) }).then(res => res.json());
        const org = (await (await fetch('/api/orgs')).json()).find(item => item.name === name);
        const plan = Array.from({ length: 3 }, () => ({ morning: '', afternoon: '', evening: '' }));
        const trip = await send('POST', '/api/trips', { title: 'Lisbon client visit', destination: 'Lisbon, Portugal', startDate, plan });
        await send('PUT', `/api/trips/${trip.id}`, { ...trip, organizationId: org.id });
    }, { startDate: start, orgName });

    // The admin sees business days only, as CSV too; the traveler sees that they looked.
    await page.fill('#org-report-from', await browserDay(page, -30));
    await page.fill('#org-report-to', await browserDay(page, 0));
    await manage.getByRole('button', { name: 'Show business days' }).click();
    const row = page.locator('.org-report tr', { hasText: worker });
    await expect(row).toContainText('Portugal 6');
    await expect(row).toContainText('Portugal A1: 6/5');
    await expect(row).toContainText('⛔ Reached');
    await expect(page.locator('.org-report')).not.toContainText('Lisbon');
    // The forecast counts the trip ahead, without its destination or dates.
    await expect(row).toContainText('1 business trip planned');
    await expect(row).toContainText('With planned trips: 9 of 5 days, reached');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /CSV for your adviser/ }).click();
    expect((await download).suggestedFilename()).toMatch(/^globex-\d+-business-days-.*\.csv$/);

    await other.click('#account-btn');
    await other.click('#orgs-btn');
    await expect(joined.locator('#audit-title + .dialog-list')).toContainText(boss);
    await expect(joined.locator('#audit-title + .dialog-list')).toContainText('viewed business-day counts');
    expect(errors).toEqual([]);
    expect(otherErrors).toEqual([]);
});
