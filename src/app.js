'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const pinoHttp = require('pino-http');
const { rateLimit } = require('express-rate-limit');

const { csrfProtection, csrfTokenRoute } = require('./middleware/csrf');
const { createUserRepository, createMarkerRepository, createTripRepository } = require('./repositories');
const { createAuthRouter, createPassport, requireAuth } = require('./routes/auth');
const { createMarkerRouter } = require('./routes/markers');
const { createProfileRouter, createPublicProfileRouter } = require('./routes/profile');
const { createGeocodeRouter } = require('./routes/geocode');
const { createTripRouter } = require('./routes/trips');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function jsonLimiter(limit, windowMs, message) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: message }
    });
}

/**
 * Builds the Express application. Dependencies are injected so tests and the
 * production entry point share exactly the same wiring.
 */
function createApp({ config, pool, logger, metrics, geocoder, state = { shuttingDown: false } }) {
    const app = express();
    const users = createUserRepository(pool);
    const markers = createMarkerRepository(pool);
    const trips = createTripRepository(pool);
    const passport = createPassport(users);

    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);

    app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
    app.get('/readyz', async (req, res) => {
        if (state.shuttingDown) return res.status(503).json({ status: 'shutting-down' });
        try {
            await pool.query('SELECT 1');
            return res.json({ status: 'ready' });
        } catch (err) {
            logger.warn({ err }, 'Readiness check failed');
            return res.status(503).json({ status: 'database-unavailable' });
        }
    });

    app.use(pinoHttp({
        logger,
        serializers: {
            req: req => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
            res: res => ({ statusCode: res.statusCode })
        },
        autoLogging: { ignore: req => req.url.startsWith('/vendor/') || req.url.startsWith('/data/') },
        customLogLevel: (req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
        }
    }));
    app.use(metrics.httpMiddleware);

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                // Users may attach photo links hosted anywhere over HTTPS.
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'", 'https://en.wikivoyage.org'],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
                upgradeInsecureRequests: config.isProduction ? [] : null
            }
        },
        strictTransportSecurity: config.isProduction,
        crossOriginEmbedderPolicy: false
    }));

    app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '1h' }));

    app.use('/api/markers/import', express.json({ limit: '3mb' }));
    app.use(express.json({ limit: '100kb' }));

    app.use(session({
        store: new PgSession({ pool, tableName: 'sessions', createTableIfMissing: false, pruneSessionInterval: 15 * 60 }),
        name: config.session.cookieName,
        secret: config.session.secret,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        proxy: Boolean(config.trustProxy),
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.session.secureCookie,
            maxAge: config.session.maxAgeMs
        }
    }));
    app.use(passport.initialize());
    app.use(passport.session());

    const api = express.Router();
    api.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    api.use(jsonLimiter(config.rateLimit.apiPerMinute, 60_000, 'Too many requests, please slow down.'));
    api.get('/csrf-token', csrfTokenRoute);
    api.use(csrfProtection);

    const authLimiter = jsonLimiter(config.rateLimit.authPerWindow, 15 * 60_000,
        'Too many attempts, please try again later.');
    api.use('/auth', createAuthRouter({ passport, users, authLimiter, metrics, logger }));
    api.use('/public', createPublicProfileRouter({ users, markers }));
    api.use('/geocode', requireAuth,
        jsonLimiter(config.rateLimit.geocodePerMinute, 60_000, 'Too many place searches, please slow down.'),
        createGeocodeRouter({ geocoder, logger }));
    api.use('/profile', requireAuth, createProfileRouter({ users }));
    api.use('/markers', requireAuth, createMarkerRouter({ pool, markers }));
    api.use('/trips', requireAuth, createTripRouter({ trips }));
    api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
    app.use('/api', api);

    app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'Request body must be valid JSON.' });
        }
        if (err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request body is too large.' });
        }
        req.log.error({ err }, 'Unhandled request error');
        return res.status(500).json({ error: 'Internal server error.' });
    });

    return app;
}

module.exports = { createApp };
