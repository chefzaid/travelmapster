'use strict';

// Passkeys, two-step sign-in secrets and recovery codes (ADR 0027).
const { withTransaction } = require('./db/pool');

const PASSKEY_COLUMNS = `id, name, transports, created_at AS "createdAt", last_used_at AS "lastUsedAt"`;

function createSecurityRepository(db) {
    return {
        /** The passkeys of a user, without their keys, newest first. */
        async listPasskeys(userId) {
            const { rows } = await db.query(`SELECT ${PASSKEY_COLUMNS} FROM passkeys WHERE user_id = $1 ORDER BY created_at DESC, id`, [userId]);
            return rows;
        },

        /** A passkey with its key and counter, by credential id. */
        async findPasskey(id) {
            const { rows } = await db.query(
                `SELECT id, user_id AS "userId", public_key AS "publicKey", counter::int AS counter, transports FROM passkeys WHERE id = $1`,
                [id]
            );
            return rows[0] || null;
        },

        async addPasskey(userId, { id, publicKey, counter, transports, name }) {
            const { rows } = await db.query(
                `INSERT INTO passkeys (id, user_id, public_key, counter, transports, name) VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING ${PASSKEY_COLUMNS}`,
                [id, userId, Buffer.from(publicKey), counter, transports, name]
            );
            return rows[0];
        },

        async usePasskey(id, counter) {
            await db.query('UPDATE passkeys SET counter = $2, last_used_at = now() WHERE id = $1', [id, counter]);
        },

        async removePasskey(userId, id) {
            const { rowCount } = await db.query('DELETE FROM passkeys WHERE user_id = $1 AND id = $2', [userId, id]);
            return rowCount > 0;
        },

        /** The sealed secret, whether it is on and the last step used; null without one. */
        async findTotp(userId) {
            const { rows } = await db.query(
                `SELECT secret, enabled_at IS NOT NULL AS enabled, last_step::int AS "lastStep" FROM totp_secrets WHERE user_id = $1`,
                [userId]
            );
            return rows[0] || null;
        },

        /** Starts setting up two-step sign-in with a new secret, replacing one not yet on. */
        async startTotp(userId, sealed) {
            const { rowCount } = await db.query(
                `INSERT INTO totp_secrets (user_id, secret) VALUES ($1, $2)
                 ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, last_step = NULL, created_at = now()
                 WHERE totp_secrets.enabled_at IS NULL`,
                [userId, sealed]
            );
            return rowCount > 0;
        },

        /** Turns the step on with its first code's step, and stores fresh recovery code hashes. */
        async enableTotp(userId, step, codeHashes) {
            await withTransaction(db, async client => {
                await client.query('UPDATE totp_secrets SET enabled_at = now(), last_step = $2 WHERE user_id = $1', [userId, step]);
                await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
                await client.query('INSERT INTO recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])', [userId, codeHashes]);
            });
        },

        /** Records a used step; false when another sign-in used it (or a later one) first. */
        async useTotpStep(userId, step) {
            const { rowCount } = await db.query(
                'UPDATE totp_secrets SET last_step = $2 WHERE user_id = $1 AND (last_step IS NULL OR last_step < $2)',
                [userId, step]
            );
            return rowCount > 0;
        },

        async disableTotp(userId) {
            await withTransaction(db, async client => {
                await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
                await client.query('DELETE FROM totp_secrets WHERE user_id = $1', [userId]);
            });
        },

        /** Spends a recovery code; false when it is unknown or used. */
        async useRecoveryCode(userId, codeHash) {
            const { rowCount } = await db.query(
                `UPDATE recovery_codes SET used_at = now()
                 WHERE id = (SELECT id FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)`,
                [userId, codeHash]
            );
            return rowCount > 0;
        },

        /** Whether the account signs in with more than a password: a passkey or two-step sign-in. */
        async hasSecondFactor(userId) {
            const { rows } = await db.query(
                `SELECT EXISTS (SELECT 1 FROM passkeys WHERE user_id = $1)
                     OR EXISTS (SELECT 1 FROM totp_secrets WHERE user_id = $1 AND enabled_at IS NOT NULL) AS strong`,
                [userId]
            );
            return rows[0].strong;
        },

        async recoveryCodesLeft(userId) {
            const { rows } = await db.query('SELECT count(*)::int AS left FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
            return rows[0].left;
        }
    };
}

module.exports = { createSecurityRepository };
