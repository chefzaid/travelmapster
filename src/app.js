'use strict';

const path = require('node:path');
const express = require('express');
const { default: helmet } = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pinoHttp } = require('pino-http');
const { rateLimit } = require('express-rate-limit');

const { csrfProtection, csrfTokenRoute } = require('./middleware/csrf');
const { createAssets } = require('./assets');
const { brotliStatic } = require('./precompressed');
const { PUBLIC_PAGES, pageWithMeta, robotsTxt, sitemapXml, siteOrigin } = require('./seo');
const { createPublicMaps } = require('./public-map');
const { PgRateLimitStore } = require('./rate-limit-store');
const {
    createUserRepository, createMarkerRepository, createVisitRepository, createLedgerRepository, createTripRepository
} = require('./repositories');
const { createAuthRouter, createPassport, publicUser, requireAuth } = require('./routes/auth');
const { createSecurityRouter } = require('./routes/security');
const { createSecurityRepository } = require('./security-repository');
const { createMarkerRouter } = require('./routes/markers');
const { createVisitRouter } = require('./routes/visits');
const { createLedgerRouter } = require('./routes/ledger');
const { createProfileRouter, createPublicProfileRouter } = require('./routes/profile');
const { createGeocodeRouter } = require('./routes/geocode');
const { createTripRouter } = require('./routes/trips');
const { createPlacesRouter } = require('./routes/places');
const { createExportRouter } = require('./routes/export');
const { createFollowRouter } = require('./routes/follows');
const { createFollowRepository } = require('./follow-repository');
const { createOrgRouter } = require('./routes/orgs');
const { createOrgRepository } = require('./org-repository');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function jsonLimiter(pool, name, limit, windowMs, message) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: message },
        // Counters live in PostgreSQL so every replica enforces one shared limit.
        store: new PgRateLimitStore(pool, name)
    });
}

/**
 * Builds the Express application. Dependencies are injected so tests and the
 * production entry point share exactly the same wiring.
 */
function createApp({ config, pool, logger, metrics, geocoder, places, state = { shuttingDown: false } }) {
    const app = express();
    const users = createUserRepository(pool);
    const markers = createMarkerRepository(pool);
    const visits = createVisitRepository(pool);
    const ledger = createLedgerRepository(pool);
    const trips = createTripRepository(pool);
    const security = createSecurityRepository(pool);
    const follows = createFollowRepository(pool);
    const orgs = createOrgRepository(pool);
    const passport = createPassport(users, logger);
    const assets = createAssets(PUBLIC_DIR);
    const publicMaps = createPublicMaps({ users, markers, publicDir: PUBLIC_DIR });

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
        autoLogging: { ignore: req => /^\/(a|vendor|data)\//.test(req.url) },
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

    // Pages are never cached and link every asset under /a/<fingerprint>/, which is cached
    // for a year: a release changes the fingerprint, so browsers and the CDN never mix old
    // and new scripts, styles or map data.
    const sendPage = (res, file) => res.set('Cache-Control', 'no-cache').type('html').send(assets.pages[file]);
    app.get(['/', '/index.html'], async (req, res) => {
        if (req.query.u === undefined) return sendPage(res, 'index.html');
        // A shared map gets its own title and link preview; it stays out of search results
        // unless its owner opted in (ADR 0023). Private and missing maps look the same.
        const map = await publicMaps.find(req.query.u);
        const meta = map && publicMaps.meta(map, siteOrigin(config, req));
        if (!meta?.indexed) res.set('X-Robots-Tag', 'noindex');
        if (!meta) return sendPage(res, 'index.html');
        return res.set('Cache-Control', 'no-cache').type('html').send(pageWithMeta(assets.pages['index.html'], meta));
    });
    // The picture shown when a shared map's link is posted. Rendering costs CPU, so it has its
    // own limit and is cached by its colours.
    app.get('/og/:file', jsonLimiter(pool, 'og', config.rateLimit.previewPerMinute, 60_000, 'Too many requests, please slow down.'), async (req, res) => {
        const [, username] = /^(.+)\.png$/.exec(req.params.file) || [];
        const map = await publicMaps.find(username);
        if (!map) return res.status(404).json({ error: 'Map not found.' });
        const { png, etag } = await publicMaps.image(map);
        res.set({ 'Cache-Control': 'public, max-age=3600', ETag: etag, 'X-Robots-Tag': 'noindex' });
        if (req.fresh) return res.status(304).end();
        return res.type('png').send(png);
    });
    app.get('/schengen-calculator', (req, res) => sendPage(res, 'schengen-calculator.html'));
    // A public map other websites may frame (ADR 0020): only this page relaxes framing, and it
    // stays out of search results like shared maps.
    app.get('/embed/:username', (req, res) => {
        res.set('Content-Security-Policy', res.get('Content-Security-Policy').replace("frame-ancestors 'none'", 'frame-ancestors *'));
        res.removeHeader('X-Frame-Options');
        res.set('X-Robots-Tag', 'noindex');
        sendPage(res, 'embed.html');
    });
    app.get('/schengen-calculator.html', (req, res) => res.redirect(301, '/schengen-calculator'));
    app.get('/robots.txt', (req, res) => {
        res.set('Cache-Control', 'no-cache').type('text/plain').send(robotsTxt(siteOrigin(config, req)));
    });
    app.get('/sitemap.xml', async (req, res) => {
        const maps = (await users.listIndexed()).map(name => `/?u=${encodeURIComponent(name)}`);
        res.set('Cache-Control', 'no-cache').type('application/xml').send(sitemapXml(siteOrigin(config, req), [...PUBLIC_PAGES, ...maps]));
    });
    const immutable = 'public, max-age=31536000, immutable';
    // One cache of compressed files for every mount.
    const compressed = new Map();
    app.use('/a/:version', brotliStatic(PUBLIC_DIR, immutable, compressed), express.static(PUBLIC_DIR, {
        index: false,
        setHeaders: res => res.set('Cache-Control', immutable)
    }));
    // Unversioned paths (the favicon, older links) always revalidate.
    for (const mount of [assets.placeholder, '/']) {
        app.use(mount, brotliStatic(PUBLIC_DIR, 'no-cache', compressed), express.static(PUBLIC_DIR, { index: false, setHeaders: res => res.set('Cache-Control', 'no-cache') }));
    }

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
    api.use(jsonLimiter(pool, 'api', config.rateLimit.apiPerMinute, 60_000, 'Too many requests, please slow down.'));
    api.get('/csrf-token', csrfTokenRoute);
    api.use(csrfProtection);

    const authLimiter = jsonLimiter(pool, 'auth', config.rateLimit.authPerWindow, 15 * 60_000,
        'Too many attempts, please try again later.');
    const registerLimiter = jsonLimiter(pool, 'register', config.rateLimit.registerPerHour, 60 * 60_000,
        'Too many new accounts from this network, please try again later.');
    api.use('/auth', createAuthRouter({ passport, users, security, config, authLimiter, registerLimiter, metrics, logger }));
    api.use('/security', createSecurityRouter({ config, users, security, authLimiter, requireAuth, publicUser, metrics, logger }));
    api.use('/public', createPublicProfileRouter({ users, markers }));
    api.use('/places', createPlacesRouter({ places }));
    api.use('/geocode', requireAuth,
        jsonLimiter(pool, 'geocode', config.rateLimit.geocodePerMinute, 60_000, 'Too many place searches, please slow down.'),
        createGeocodeRouter({ geocoder, logger }));
    api.use('/profile', requireAuth, createProfileRouter({ users }));
    api.use('/markers', requireAuth, createMarkerRouter({ pool, markers, visits, orgs, metrics }));
    api.use('/visits', requireAuth, createVisitRouter({ visits, orgs }));
    api.use('/ledger', requireAuth, createLedgerRouter({ ledger, metrics }));
    api.use('/trips', requireAuth, createTripRouter({ trips, users }));
    api.use('/follows', requireAuth, createFollowRouter({ users, follows }));
    api.use('/orgs', requireAuth, createOrgRouter({ orgs, users, security }));
    api.use('/export', requireAuth, createExportRouter({ markers, trips, ledger, security, follows, orgs, metrics }));
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
