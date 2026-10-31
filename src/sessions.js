'use strict';

// Signed-in devices: each session started by signing in records the browser and system it was
// started on (read from the User-Agent, never stored whole) and when, so the traveler can see
// where the account is open and sign any of it out. Sessions are named to the browser by a hash
// of their id, never the id itself.
const crypto = require('node:crypto');

const BROWSERS = [[/Edg\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser/, 'Samsung Internet'], [/Firefox\/|FxiOS/, 'Firefox'],
    [/Chrome\/|CriOS/, 'Chrome'], [/Safari\//, 'Safari']];
const SYSTEMS = [[/iPhone|iPod/, 'iOS'], [/iPad/, 'iPadOS'], [/Android/, 'Android'], [/CrOS/, 'ChromeOS'], [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'], [/Linux/, 'Linux']];

const nameOf = (list, userAgent) => list.find(([pattern]) => pattern.test(userAgent))?.[1] || null;

/** The browser and system a User-Agent names, such as `{ browser: 'Firefox', os: 'macOS' }`. */
function describeDevice(userAgent = '') {
    const text = String(userAgent).slice(0, 512);
    return { browser: nameOf(BROWSERS, text), os: nameOf(SYSTEMS, text) };
}

/** How a session is named to its owner: a hash of its id. */
const sessionKey = sid => crypto.createHash('sha256').update(String(sid)).digest('hex').slice(0, 24);

/** Signs in, with a new session (passport 0.7 regenerates it, preventing fixation) that records the device. */
async function login(req, user) {
    await new Promise(/** @param {(value?: void) => void} resolve */ (resolve, reject) => {
        req.login(user, err => (err ? reject(err) : resolve()));
    });
    req.session.device = { ...describeDevice(req.get('user-agent')), signedInAt: new Date().toISOString() };
}

/** The sessions of a traveler and signing them out; `maxAgeMs` turns a session's expiry into its last use. */
function createSessionRepository(db, maxAgeMs) {
    async function rows(userId) {
        const { rows: found } = await db.query(
            "SELECT sid, sess, expire FROM sessions WHERE sess -> 'passport' ->> 'user' = $1 AND expire > now() ORDER BY expire DESC",
            [String(userId)]
        );
        return found;
    }
    return {
        /** The open sessions, the most recently used first, with the current one marked. */
        async list(userId, currentSid) {
            return (await rows(userId)).map(({ sid, sess, expire }) => ({
                id: sessionKey(sid),
                browser: sess.device?.browser || null,
                os: sess.device?.os || null,
                signedInAt: sess.device?.signedInAt || null,
                lastSeenAt: new Date(new Date(expire).getTime() - maxAgeMs).toISOString(),
                current: sid === currentSid
            }));
        },

        /** Ends one session by its key; resolves to false when it is not one of the traveler's. */
        async end(userId, key) {
            const match = (await rows(userId)).find(row => sessionKey(row.sid) === key);
            if (!match) return false;
            await db.query('DELETE FROM sessions WHERE sid = $1', [match.sid]);
            return true;
        }
    };
}

module.exports = { createSessionRepository, describeDevice, login, sessionKey };
