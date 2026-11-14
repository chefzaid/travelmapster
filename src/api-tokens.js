'use strict';

// Personal API tokens: read-only access to the traveler's own data on the documented API
// (docs/api/openapi.json), sent as "Authorization: Bearer tmk_…". A token reads (GET) every
// route but sign-in security and the tokens themselves, and never writes. Only a SHA-256 hash
// is stored; the token is shown once, and revoking it ends it at once.
const crypto = require('node:crypto');

const PREFIX = 'tmk_';
const TOKEN_PATTERN = /^tmk_[A-Za-z0-9_-]{43}$/;
const TOKENS_MAX = 10;
const NAME_MAX = 60;
// Paths a token never reaches, even to read: how the account signs in, and the tokens.
const OFF_LIMITS = /^\/(security|api-tokens)(\/|$)/;

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => `${PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
const COLUMNS = 'id, name, created_at AS "createdAt", last_used_at AS "lastUsedAt"';

function createApiTokenRepository(db) {
    return {
        async list(userId) {
            const { rows } = await db.query(`SELECT ${COLUMNS} FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [userId]);
            return rows;
        },
        /** A new token for the traveler, or null once they hold ten. */
        async create(userId, name, tokenHash) {
            const { rows } = await db.query(
                `INSERT INTO api_tokens (user_id, name, token_hash)
                 SELECT $1, $2, $3 WHERE (SELECT count(*) FROM api_tokens WHERE user_id = $1) < $4
                 RETURNING ${COLUMNS}`,
                [userId, name, tokenHash, TOKENS_MAX]
            );
            return rows[0] || null;
        },
        /** Revokes one of the traveler's tokens; returns its name, or null. */
        async revoke(userId, id) {
            const { rows } = await db.query('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2 RETURNING name', [id, userId]);
            return rows[0]?.name ?? null;
        },
        /** The token behind a hash, noting its use at most once a minute. */
        async use(tokenHash) {
            const { rows } = await db.query(
                `UPDATE api_tokens SET last_used_at = CASE WHEN last_used_at IS NULL OR last_used_at < now() - interval '1 minute' THEN now() ELSE last_used_at END
                 WHERE token_hash = $1 RETURNING id, name, user_id AS "userId"`,
                [tokenHash]
            );
            return rows[0] || null;
        }
    };
}

/**
 * Signs a request in with its API token, if it carries one: read-only, and never to sign-in
 * security. A request without one goes on as it is, with its session if any.
 */
function apiTokenAuth({ tokens, users }) {
    return async (req, res, next) => {
        const header = req.get('authorization') || '';
        const [, token] = /^Bearer\s+(\S+)$/i.exec(header) || [];
        if (!token) return next();
        const found = TOKEN_PATTERN.test(token) ? await tokens.use(hashToken(token)) : null;
        const user = found && await users.findById(found.userId);
        if (!user || user.deletion_requested_at) return res.status(401).json({ error: 'This API token is not valid.' });
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(403).json({ error: 'API tokens can only read.' });
        if (OFF_LIMITS.test(req.path)) return res.status(403).json({ error: 'API tokens cannot reach sign-in security.' });
        req.user = user;
        req.apiToken = { id: found.id, name: found.name };
        return next();
    };
}

/** A token's name from the request body: 1 to 60 characters. */
function parseTokenName(body) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    return name && name.length <= NAME_MAX ? { name } : { error: 'Name the token in 1 to 60 characters.' };
}

module.exports = { apiTokenAuth, createApiTokenRepository, hashToken, newToken, parseTokenName };
