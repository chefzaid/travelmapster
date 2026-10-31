'use strict';

// Calendar subscription: a private link to an iCalendar feed of the traveler's trips and planned
// stays (public/js/itinerary.js feedCalendar), for Google, Apple or Outlook calendars, which
// fetch it on their own schedule. The link's token is shown once and only its hash is stored;
// a new link replaces the old one, and turning it off ends it.
const crypto = require('node:crypto');
const { browserModule, countryData } = require('./browser-modules');

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function createCalendarFeedRepository(db) {
    return {
        async find(userId) {
            const { rows } = await db.query('SELECT created_at AS "createdAt" FROM calendar_feeds WHERE user_id = $1', [userId]);
            return rows[0] || null;
        },
        async replace(userId, tokenHash) {
            const { rows } = await db.query(
                `INSERT INTO calendar_feeds (user_id, token_hash) VALUES ($1, $2)
                 ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()
                 RETURNING created_at AS "createdAt"`,
                [userId, tokenHash]
            );
            return rows[0];
        },
        async remove(userId) {
            await db.query('DELETE FROM calendar_feeds WHERE user_id = $1', [userId]);
        },
        async userFor(tokenHash) {
            const { rows } = await db.query('SELECT user_id AS "userId" FROM calendar_feeds WHERE token_hash = $1', [tokenHash]);
            return rows[0]?.userId ?? null;
        }
    };
}

/** The feed itself, for whoever holds the link: trips and planned stays as iCalendar. */
function calendarFeedHandler({ feeds, trips, ledger }) {
    return async (req, res) => {
        const [, token] = /^(.+)\.ics$/.exec(req.params.file) || [];
        if (!token || !TOKEN_PATTERN.test(token)) return res.status(404).type('text').send('Not found');
        const userId = await feeds.userFor(hashToken(token));
        if (!userId) return res.status(404).type('text').send('Not found');
        const [owned, settings, { feedCalendar }, { index }] = await Promise.all([
            trips.listOwned(userId), ledger.findSettings(userId), browserModule('itinerary.js'), countryData()
        ]);
        const calendar = feedCalendar({ trips: owned, planned: settings.planned, nameOf: id => index.byId.get(id)?.name || id });
        res.set({ 'Cache-Control': 'private, max-age=900', 'X-Robots-Tag': 'noindex', 'Content-Disposition': 'inline; filename="travelmapster.ics"' });
        return res.type('text/calendar; charset=utf-8').send(calendar);
    };
}

module.exports = { calendarFeedHandler, createCalendarFeedRepository, hashToken };
