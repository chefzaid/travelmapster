'use strict';

const { defineConfig, devices } = require('@playwright/test');

const port = Number(process.env.E2E_PORT || 3100);

module.exports = defineConfig({
    testDir: 'test/e2e',
    timeout: 30_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'test-results/playwright-junit.xml' }]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        trace: 'retain-on-failure',
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node src/server.js',
        url: `http://127.0.0.1:${port}/readyz`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
            PORT: String(port),
            METRICS_PORT: String(port + 1),
            NODE_ENV: 'test',
            LOG_LEVEL: 'warn',
            // Never fall back to DATABASE_URL: the suite creates accounts in this database.
            DATABASE_URL: process.env.E2E_DATABASE_URL
                || process.env.TEST_DATABASE_URL
                || 'postgres://postgres@127.0.0.1:55432/travelmapster_test',
            SESSION_SECRET: 'e2e-secret-that-is-long-enough-for-tests',
            // Limits are shared in the database and outlive runs; journeys sign up often.
            RATE_LIMIT_AUTH: '1000'
        }
    }
});
