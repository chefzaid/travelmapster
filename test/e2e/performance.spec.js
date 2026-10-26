'use strict';

// Performance budget for the landing page on a mid-range phone: 4x slower CPU and a slow 4G
// network, as Lighthouse emulates a Moto G Power. The budgets live in performance-budget.json.
const { test, expect, devices } = require('@playwright/test');
const budget = require('./performance-budget.json');

test.use({ ...devices['Moto G4'] });

test('the landing page stays within its performance budget on a mid-range phone', async ({ page }) => {
    test.setTimeout(90_000);
    await page.route(/wikivoyage\.org/, route => route.abort());
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    const urls = new Map();
    let pageBytes = 0;
    let mapDataBytes = 0;
    cdp.on('Network.responseReceived', event => urls.set(event.requestId, event.response.url));
    cdp.on('Network.loadingFinished', event => {
        pageBytes += event.encodedDataLength;
        if (/\/data\//.test(urls.get(event.requestId) || '')) mapDataBytes += event.encodedDataLength;
    });

    await page.goto('/');
    await expect(page.locator('#home')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#app[data-map="ready"] #welcome-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#demo-ledger')).toContainText('Schengen days', { timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    const vitals = await page.evaluate(() => new Promise(resolve => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve({ lcp, cls }), 500);
    }));

    const measured = {
        pageWeightKB: Math.round(pageBytes / 1024),
        mapDataKB: Math.round(mapDataBytes / 1024),
        lcpMs: Math.round(vitals.lcp),
        cls: Math.round(vitals.cls * 1000) / 1000
    };
    console.log(`Performance on a mid-range phone: ${JSON.stringify(measured)}; budget ${JSON.stringify(budget)}`);
    expect(measured.pageWeightKB, 'page weight in KB').toBeLessThanOrEqual(budget.pageWeightKB);
    expect(measured.mapDataKB, 'map data in KB').toBeLessThanOrEqual(budget.mapDataKB);
    expect(measured.lcpMs, 'Largest Contentful Paint in ms').toBeLessThanOrEqual(budget.lcpMs);
    expect(measured.cls, 'Cumulative Layout Shift').toBeLessThanOrEqual(budget.cls);
});
