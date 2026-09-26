'use strict';

const { Pool, types } = require('pg');

// Return DATE columns as plain YYYY-MM-DD strings (no timezone shifts) and
// BIGINT ids as numbers; ids stay far below Number.MAX_SAFE_INTEGER.
types.setTypeParser(types.builtins.DATE, value => value);
types.setTypeParser(types.builtins.INT8, value => Number(value));

function createPool(databaseConfig, logger) {
    const pool = new Pool({
        connectionString: databaseConfig.connectionString,
        max: databaseConfig.maxConnections,
        ssl: databaseConfig.ssl,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        application_name: 'travelmapster'
    });

    // An idle client error must not crash the process; the pool replaces the client.
    pool.on('error', err => logger.error({ err }, 'Unexpected PostgreSQL client error'));
    return pool;
}

async function withTransaction(pool, work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { createPool, withTransaction };
