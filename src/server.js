'use strict';

const http = require('node:http');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { createMetrics } = require('./metrics');
const { createGeocoder, createPgSlots } = require('./services/geocoder');
const { createPlaceIndex } = require('./services/places');
const { createApp } = require('./app');

const MIGRATION_ATTEMPTS = 10;
const SHUTDOWN_GRACE_MS = 5_000;

async function migrateWithRetry(pool, logger) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await migrate(pool, logger);
        } catch (err) {
            if (attempt >= MIGRATION_ATTEMPTS) throw err;
            const delay = Math.min(1000 * 2 ** attempt, 15_000);
            logger.warn({ err, attempt, delay }, 'Database not ready, retrying migrations');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function main() {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    if (!config.isProduction && !process.env.SESSION_SECRET) {
        logger.warn('SESSION_SECRET is not set; using an insecure development secret.');
    }

    const pool = createPool(config.database, logger);
    const applied = await migrateWithRetry(pool, logger);
    logger.info({ applied }, 'Database migrations complete');

    const metrics = createMetrics();
    const geocoder = createGeocoder(config.geocoder, fetch, createPgSlots(pool, config.geocoder.minIntervalMs));
    const state = { shuttingDown: false };
    // Load the town index in the background so the first search does not wait for it.
    const places = createPlaceIndex();
    places.warm().catch(err => logger.error({ err }, 'Place index failed to load'));
    const app = createApp({ config, pool, logger, metrics, geocoder, places, state });

    const server = http.createServer(app);
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
    server.listen(config.port, () => logger.info({ port: config.port }, 'TravelMapster is listening'));

    // Metrics live on a separate port that the Service and Ingress never expose.
    const metricsServer = http.createServer(async (req, res) => {
        if (req.url !== '/metrics') {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': metrics.registry.contentType });
        res.end(await metrics.registry.metrics());
    });
    metricsServer.listen(config.metricsPort, () => logger.info({ port: config.metricsPort }, 'Metrics endpoint is listening'));

    const shutdown = signal => {
        if (state.shuttingDown) return;
        state.shuttingDown = true;
        logger.info({ signal }, 'Shutting down');
        // Fail readiness first so the load balancer drains traffic, then close.
        setTimeout(() => {
            server.close(() => {
                metricsServer.close();
                pool.end().finally(() => {
                    logger.info('Shutdown complete');
                    process.exit(0);
                });
            });
            server.closeIdleConnections();
            setTimeout(() => process.exit(1), 20_000).unref();
        }, config.isProduction ? SHUTDOWN_GRACE_MS : 0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

main().catch(err => {
    // The logger may not exist yet, so fall back to a structured stderr line.
    process.stderr.write(`${JSON.stringify({ level: 'fatal', msg: 'Startup failed', err: err.message })}\n`);
    process.exit(1);
});
