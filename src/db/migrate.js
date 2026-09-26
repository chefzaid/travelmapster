'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
// Arbitrary constant shared by every replica so only one runs migrations at a time.
const MIGRATION_LOCK_ID = 727_463_001;

function listMigrations() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(file => /^\d{3}_[\w-]+\.sql$/.test(file))
        .sort()
        .map(file => ({
            version: file.slice(0, 3),
            name: file,
            sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
        }));
}

/**
 * Applies pending SQL migrations in order, each in its own transaction,
 * under a session-level advisory lock so concurrent pods cannot race.
 */
async function migrate(pool, logger) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        const { rows } = await client.query('SELECT version FROM schema_migrations');
        const applied = new Set(rows.map(row => row.version));
        const pending = listMigrations().filter(migration => !applied.has(migration.version));

        for (const migration of pending) {
            logger.info({ migration: migration.name }, 'Applying database migration');
            await client.query('BEGIN');
            try {
                await client.query(migration.sql);
                await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
                    [migration.version, migration.name]);
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${migration.name} failed: ${err.message}`, { cause: err });
            }
        }
        return pending.map(migration => migration.name);
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
        client.release();
    }
}

module.exports = { migrate, listMigrations };

if (require.main === module) {
    const { loadConfig } = require('../config');
    const { createLogger } = require('../logger');
    const { createPool } = require('./pool');
    const config = loadConfig();
    const logger = createLogger(config.logLevel === 'silent' ? 'info' : config.logLevel);
    const pool = createPool(config.database, logger);
    migrate(pool, logger)
        .then(applied => logger.info({ applied }, 'Database is up to date'))
        .catch(err => {
            logger.fatal({ err }, 'Database migration failed');
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}
