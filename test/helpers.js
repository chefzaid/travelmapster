'use strict';

const http = require('node:http');
const request = require('supertest');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { createMetrics } = require('../src/metrics');
const { createApp } = require('../src/app');

const DATABASE_URL = process.env.TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || 'postgres://postgres@127.0.0.1:55432/travelmapster_test';

// Tests drop the whole schema, so refuse any database that is not clearly a test one.
const databaseName = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
if (!/test/i.test(databaseName)) {
    throw new Error(`Refusing to run tests against database "${databaseName}": they drop its schema. `
        + 'Set TEST_DATABASE_URL to a disposable database whose name contains "test".');
}

function fakeGeocoder() {
    const calls = [];
    return {
        calls,
        failNext: false,
        async search(query, kind, limit) {
            calls.push({ query, kind, limit });
            if (this.failNext) {
                this.failNext = false;
                throw new Error('upstream down');
            }
            return [{ name: kind === 'city' ? `${query}, Testland` : query, displayName: query, lat: 10, lng: 20 }];
        }
    };
}

/** Starts a fresh schema and an app wired exactly like production. */
async function createTestContext(envOverrides = {}) {
    const config = loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL,
        SESSION_SECRET: 'test-secret-that-is-long-enough-for-production-use',
        RATE_LIMIT_AUTH: '1000',
        RATE_LIMIT_API: '10000',
        RATE_LIMIT_GEOCODE: '1000',
        ...envOverrides
    });
    const logger = createLogger('silent');
    const pool = createPool(config.database, logger);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool, logger);
    const geocoder = fakeGeocoder();
    const state = { shuttingDown: false };
    const app = createApp({ config, pool, logger, metrics: createMetrics(), geocoder, state });
    // One long-lived server keeps agent cookies on a stable address.
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        app,
        server,
        pool,
        geocoder,
        state,
        /** A second app on the same database, like another replica behind the load balancer. */
        async createReplica() {
            const replica = http.createServer(createApp({ config, pool, logger, metrics: createMetrics(), geocoder, state }));
            await new Promise(resolve => replica.listen(0, '127.0.0.1', resolve));
            return replica;
        },
        async close() {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            await pool.end();
        }
    };
}

/** A cookie-keeping client that sends the CSRF token like the browser does. */
function createClient(target) {
    const agent = request.agent(target);
    let csrfToken = null;

    async function token() {
        if (!csrfToken) {
            const res = await agent.get('/api/csrf-token').expect(200);
            csrfToken = res.body.csrfToken;
        }
        return csrfToken;
    }

    function remember(res) {
        if (res.body && res.body.csrfToken) csrfToken = res.body.csrfToken;
        return res;
    }

    async function send(method, path, body) {
        // Fetch the token first: the agent attaches cookies when a request is created.
        const csrf = await token();
        const req = agent[method](path).set('X-CSRF-Token', csrf);
        return remember(await (body === undefined ? req : req.send(body)));
    }

    return {
        agent,
        get: path => agent.get(path),
        post: (path, body) => send('post', path, body ?? {}),
        patch: (path, body) => send('patch', path, body),
        put: (path, body) => send('put', path, body),
        delete: (path, body) => send('delete', path, body),
        async register(username = 'traveler', password = 'correct horse battery') {
            return this.post('/api/auth/register', { username, password });
        }
    };
}

const sampleMarker = Object.freeze({
    lat: 48.8566,
    lng: 2.3522,
    type: 'visited',
    name: 'Paris, France',
    category: 'City',
    photoUrl: 'https://example.com/paris.jpg',
    notes: 'Louvre and croissants',
    travelDate: '2024-05-12'
});

module.exports = { createClient, createTestContext, sampleMarker, DATABASE_URL };
