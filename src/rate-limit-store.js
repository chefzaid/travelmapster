'use strict';

const CLEANUP_INTERVAL_MS = 10 * 60_000;

/**
 * express-rate-limit store backed by PostgreSQL, so every replica shares the same
 * fixed-window counters. One atomic upsert per request counts the hit and starts a
 * new window when the previous one has expired.
 */
class PgRateLimitStore {
    constructor(pool, prefix) {
        this.pool = pool;
        this.prefix = `${prefix}:`;
        this.localKeys = false;
        this.windowMs = 60_000;
        this.cleanup = null;
    }

    init(options) {
        this.windowMs = options.windowMs;
        // Expired rows are only overwritten when the same client returns; sweep the rest.
        this.cleanup = setInterval(() => {
            this.pool.query('DELETE FROM rate_limits WHERE reset_at < now()').catch(() => {});
        }, CLEANUP_INTERVAL_MS);
        this.cleanup.unref();
    }

    async get(key) {
        const { rows } = await this.pool.query(
            'SELECT hits, reset_at FROM rate_limits WHERE key = $1 AND reset_at > now()', [this.prefix + key]);
        return rows[0] ? { totalHits: rows[0].hits, resetTime: rows[0].reset_at } : undefined;
    }

    async increment(key) {
        const { rows } = await this.pool.query(
            `INSERT INTO rate_limits (key, hits, reset_at)
             VALUES ($1, 1, now() + $2 * interval '1 millisecond')
             ON CONFLICT (key) DO UPDATE SET
                 hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
                 reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
             RETURNING hits, reset_at`,
            [this.prefix + key, this.windowMs]
        );
        return { totalHits: rows[0].hits, resetTime: rows[0].reset_at };
    }

    async decrement(key) {
        await this.pool.query(
            'UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1 AND reset_at > now()', [this.prefix + key]);
    }

    async resetKey(key) {
        await this.pool.query('DELETE FROM rate_limits WHERE key = $1', [this.prefix + key]);
    }

    shutdown() {
        clearInterval(this.cleanup);
    }
}

module.exports = { PgRateLimitStore };
