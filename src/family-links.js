'use strict';

// Family view of a trip: a private, read-only link to the trip's stops and dates, for family who
// have no account, so they know where the traveler is this week. Only the trip's owner makes or
// ends it; the token is shown once and only its hash is stored (as the calendar feed's). The
// view leaves out the day plans, the packing list, the budget and who the trip is shared with.
const { hashToken } = require('./calendar-feed');
const { browserModule } = require('./browser-modules');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function createFamilyLinkRepository(db) {
    return {
        /** The link of a trip the traveler owns: `{ owned, createdAt }`, `owned` false otherwise. */
        async find(userId, tripId) {
            const { rows } = await db.query(
                `SELECT f.created_at AS "createdAt" FROM trips t LEFT JOIN trip_family_links f ON f.trip_id = t.id
                 WHERE t.id = $1 AND t.user_id = $2`,
                [tripId, userId]
            );
            return rows.length ? { owned: true, createdAt: rows[0].createdAt } : { owned: false, createdAt: null };
        },
        /** A new link for a trip the traveler owns, ending the old one; null for anyone else's trip. */
        async replace(userId, tripId, tokenHash) {
            const { rows } = await db.query(
                `INSERT INTO trip_family_links (trip_id, token_hash) SELECT id, $3 FROM trips WHERE id = $1 AND user_id = $2
                 ON CONFLICT (trip_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()
                 RETURNING created_at AS "createdAt"`,
                [tripId, userId, tokenHash]
            );
            return rows[0] || null;
        },
        /** Ends the link; false when the trip is not the traveler's own. */
        async remove(userId, tripId) {
            const { rowCount } = await db.query(
                'DELETE FROM trip_family_links f USING trips t WHERE f.trip_id = t.id AND t.id = $1 AND t.user_id = $2',
                [tripId, userId]
            );
            if (rowCount) return true;
            return (await this.find(userId, tripId)).owned;
        },
        /** The trip behind a link, with its owner's username, or null. */
        async tripFor(tokenHash) {
            const { rows } = await db.query(
                `SELECT t.title, t.destination, t.start_date AS "startDate", t.plan, t.stops, t.updated_at AS "updatedAt", u.username
                 FROM trip_family_links f JOIN trips t ON t.id = f.trip_id JOIN users u ON u.id = t.user_id
                 WHERE f.token_hash = $1 AND u.deletion_requested_at IS NULL`,
                [tokenHash]
            );
            return rows[0] || null;
        }
    };
}

/** What a family link shows: the trip's title, its stops with their dates, and nothing else. */
async function familyView(trip) {
    const { tripStops } = await browserModule('itinerary.js');
    return {
        traveler: trip.username,
        title: trip.title,
        startDate: trip.startDate,
        days: trip.plan.length,
        stops: tripStops(trip).map(({ destination, firstDay, days, startDate, endDate }) => ({ destination, firstDay, days, startDate, endDate })),
        updatedAt: trip.updatedAt
    };
}

module.exports = { TOKEN_PATTERN, createFamilyLinkRepository, familyView, hashToken };
