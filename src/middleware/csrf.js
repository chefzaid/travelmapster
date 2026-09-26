'use strict';

const crypto = require('node:crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HEADER_NAME = 'x-csrf-token';

function getOrCreateToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
    }
    return req.session.csrfToken;
}

function tokensMatch(expected, received) {
    if (typeof expected !== 'string' || typeof received !== 'string') return false;
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return expectedBuffer.length === receivedBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Synchronizer-token CSRF protection: the token lives in the server-side
 * session and must be echoed in the X-CSRF-Token header on unsafe requests.
 */
function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (tokensMatch(req.session?.csrfToken, req.get(HEADER_NAME))) return next();
    return res.status(403).json({ error: 'Invalid or missing CSRF token.', code: 'CSRF' });
}

function csrfTokenRoute(req, res) {
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: getOrCreateToken(req) });
}

module.exports = { csrfProtection, csrfTokenRoute, getOrCreateToken };
