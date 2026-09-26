'use strict';

const DEV_SESSION_SECRET = 'travelmapster-insecure-development-secret';

function readInteger(env, name, fallback) {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer, got "${raw}".`);
    }
    return value;
}

function readTrustProxy(raw) {
    if (raw === undefined || raw === '' || raw === 'false') return false;
    if (raw === 'true') return true;
    if (/^\d+$/.test(raw)) return Number(raw);
    // Comma-separated CIDRs or Express keywords such as "loopback, uniquelocal".
    return raw.split(',').map(value => value.trim()).filter(Boolean);
}

/**
 * Builds validated runtime configuration from environment variables.
 * Production refuses to start without an explicit, strong session secret.
 */
function loadConfig(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const sessionSecret = env.SESSION_SECRET || '';

    if (isProduction && sessionSecret.length < 32) {
        throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
    }

    return {
        nodeEnv,
        isProduction,
        port: readInteger(env, 'PORT', 3000),
        metricsPort: readInteger(env, 'METRICS_PORT', 9464),
        logLevel: env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
        trustProxy: readTrustProxy(env.TRUST_PROXY),
        session: {
            secret: sessionSecret || DEV_SESSION_SECRET,
            cookieName: env.SESSION_COOKIE_NAME || 'travelmapster.sid',
            maxAgeMs: readInteger(env, 'SESSION_MAX_AGE_HOURS', 24 * 7) * 60 * 60 * 1000,
            secureCookie: env.SESSION_SECURE_COOKIE
                ? env.SESSION_SECURE_COOKIE === 'true'
                : isProduction
        },
        database: {
            // pg also honours PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD.
            connectionString: env.DATABASE_URL || undefined,
            maxConnections: readInteger(env, 'DATABASE_POOL_MAX', 10),
            ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
        },
        rateLimit: {
            authPerWindow: readInteger(env, 'RATE_LIMIT_AUTH', 10),
            apiPerMinute: readInteger(env, 'RATE_LIMIT_API', 300),
            geocodePerMinute: readInteger(env, 'RATE_LIMIT_GEOCODE', 30)
        },
        geocoder: {
            baseUrl: env.GEOCODER_URL || 'https://nominatim.openstreetmap.org',
            userAgent: env.GEOCODER_USER_AGENT || 'TravelMapster/1.0 (+https://github.com/chefzaid/travelmapster)',
            minIntervalMs: readInteger(env, 'GEOCODER_MIN_INTERVAL_MS', 1100),
            timeoutMs: readInteger(env, 'GEOCODER_TIMEOUT_MS', 8000),
            cacheSize: readInteger(env, 'GEOCODER_CACHE_SIZE', 1000)
        }
    };
}

module.exports = { loadConfig, DEV_SESSION_SECRET };
