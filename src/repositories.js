'use strict';

// The legacy travel date is derived from the visits; markers.travel_date only mirrors it
// for the previous release until the contract step (ADR 0009).
const MARKER_COLUMNS = `m.id, m.lat, m.lng, m.type, m.name, m.category,
    m.photo_url AS "photoUrl", m.notes,
    (SELECT max(v.start_date) FROM visits v WHERE v.marker_id = m.id) AS "travelDate",
    COALESCE((SELECT json_agg(json_build_object(
        'id', v.id, 'startDate', v.start_date, 'endDate', v.end_date,
        'notes', v.notes, 'photoUrl', v.photo_url) ORDER BY v.start_date DESC, v.id DESC)
        FROM visits v WHERE v.marker_id = m.id), '[]'::json) AS visits`;

const VISIT_COLUMNS = `v.id, v.start_date AS "startDate", v.end_date AS "endDate",
    v.notes, v.photo_url AS "photoUrl"`;

function createUserRepository(db) {
    return {
        async findByUsername(username) {
            const { rows } = await db.query(
                'SELECT id, username, password_hash, profile_visibility FROM users WHERE lower(username) = lower($1)',
                [username]
            );
            return rows[0] || null;
        },

        async findById(id) {
            const { rows } = await db.query(
                'SELECT id, username, profile_visibility FROM users WHERE id = $1',
                [id]
            );
            return rows[0] || null;
        },

        /** Returns the new user, or null when the username is already taken. */
        async create(username, passwordHash) {
            const { rows } = await db.query(
                `INSERT INTO users (username, password_hash) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING
                 RETURNING id, username, profile_visibility`,
                [username, passwordHash]
            );
            return rows[0] || null;
        },

        async setProfileVisibility(id, visibility) {
            await db.query(
                'UPDATE users SET profile_visibility = $1, updated_at = now() WHERE id = $2',
                [visibility, id]
            );
        },

        async findPasswordHash(id) {
            const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [id]);
            return rows[0]?.password_hash || null;
        },

        async setPasswordHash(id, passwordHash) {
            await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, id]);
        },

        /** Deletes the account; markers (with their visits) and trips cascade. */
        async remove(id) {
            await db.query('DELETE FROM users WHERE id = $1', [id]);
        },

        /** Signs the user out everywhere except the given session. */
        async endSessions(id, exceptSessionId = '') {
            await db.query(
                "DELETE FROM sessions WHERE sess -> 'passport' ->> 'user' = $1 AND sid <> $2",
                [String(id), exceptSessionId]
            );
        }
    };
}

function markerValues(marker) {
    return [marker.lat, marker.lng, marker.type, marker.name, marker.category, marker.photoUrl, marker.notes];
}

function visitValues(visit) {
    return [visit.startDate, visit.endDate, visit.notes, visit.photoUrl];
}

function createMarkerRepository(db) {
    async function find(userId, markerId, client = db) {
        const { rows } = await client.query(
            `SELECT ${MARKER_COLUMNS} FROM markers m WHERE m.id = $1 AND m.user_id = $2`,
            [markerId, userId]
        );
        return rows[0] || null;
    }

    return {
        find,

        async listForUser(userId) {
            const { rows } = await db.query(
                `SELECT ${MARKER_COLUMNS} FROM markers m WHERE m.user_id = $1 ORDER BY m.id`,
                [userId]
            );
            return rows;
        },

        /**
         * Creates a place with its visits; run it in a transaction when it has visits.
         * Without a visits list, a legacy travel date becomes the first visit (migration 004).
         */
        async create(userId, marker, client = db) {
            const travelDate = marker.visits ? null : marker.travelDate ?? null;
            const { rows } = await client.query(
                `INSERT INTO markers (lat, lng, type, name, category, photo_url, notes, travel_date, user_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id`,
                [...markerValues(marker), travelDate, userId]
            );
            for (const visit of marker.visits || []) {
                await client.query(
                    `INSERT INTO visits (marker_id, start_date, end_date, notes, photo_url)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [rows[0].id, ...visitValues(visit)]
                );
            }
            return find(userId, rows[0].id, client);
        },

        /** A travel date left out keeps the visits; one sent the legacy way may add a visit. */
        async update(userId, markerId, marker) {
            const values = [...markerValues(marker), markerId, userId];
            let setTravelDate = '';
            if (marker.travelDate !== undefined) {
                values.push(marker.travelDate);
                setTravelDate = `, travel_date = $${values.length}`;
            }
            const { rowCount } = await db.query(
                `UPDATE markers SET lat = $1, lng = $2, type = $3, name = $4, category = $5,
                    photo_url = $6, notes = $7${setTravelDate}, updated_at = now()
                 WHERE id = $8 AND user_id = $9`,
                values
            );
            return rowCount ? find(userId, markerId) : null;
        },

        async remove(userId, markerId) {
            const { rowCount } = await db.query(
                'DELETE FROM markers WHERE id = $1 AND user_id = $2',
                [markerId, userId]
            );
            return rowCount > 0;
        }
    };
}

/** Visits belong to a place, so every query is scoped through the place's owner. */
function createVisitRepository(db) {
    return {
        /** Returns null when the place does not exist or belongs to someone else. */
        async listForMarker(userId, markerId) {
            const { rows } = await db.query(
                `SELECT ${VISIT_COLUMNS}
                 FROM markers m LEFT JOIN visits v ON v.marker_id = m.id
                 WHERE m.id = $1 AND m.user_id = $2
                 ORDER BY v.start_date DESC, v.id DESC`,
                [markerId, userId]
            );
            // A place without visits still yields one row of nulls from the outer join.
            if (!rows.length) return null;
            return rows.filter(row => row.id !== null);
        },

        async create(userId, markerId, visit) {
            const { rows } = await db.query(
                `INSERT INTO visits AS v (marker_id, start_date, end_date, notes, photo_url)
                 SELECT m.id, $3, $4, $5, $6 FROM markers m WHERE m.id = $1 AND m.user_id = $2
                 RETURNING ${VISIT_COLUMNS}`,
                [markerId, userId, ...visitValues(visit)]
            );
            return rows[0] || null;
        },

        async update(userId, visitId, visit) {
            const { rows } = await db.query(
                `UPDATE visits v SET start_date = $3, end_date = $4, notes = $5, photo_url = $6, updated_at = now()
                 FROM markers m
                 WHERE v.id = $1 AND m.id = v.marker_id AND m.user_id = $2
                 RETURNING ${VISIT_COLUMNS}`,
                [visitId, userId, ...visitValues(visit)]
            );
            return rows[0] || null;
        },

        async remove(userId, visitId) {
            const { rowCount } = await db.query(
                `DELETE FROM visits v USING markers m
                 WHERE v.id = $1 AND m.id = v.marker_id AND m.user_id = $2`,
                [visitId, userId]
            );
            return rowCount > 0;
        }
    };
}

const TRIP_COLUMNS = `id, title, destination, start_date AS "startDate", plan,
    created_at AS "createdAt", updated_at AS "updatedAt"`;

function createTripRepository(db) {
    return {
        async listForUser(userId) {
            const { rows } = await db.query(
                `SELECT ${TRIP_COLUMNS} FROM trips WHERE user_id = $1
                 ORDER BY COALESCE(start_date::timestamptz, created_at) DESC, id DESC`,
                [userId]
            );
            return rows;
        },

        async create(userId, trip) {
            const { rows } = await db.query(
                `INSERT INTO trips (user_id, title, destination, start_date, plan)
                 VALUES ($1, $2, $3, $4, $5::jsonb)
                 RETURNING ${TRIP_COLUMNS}`,
                [userId, trip.title, trip.destination, trip.startDate, JSON.stringify(trip.plan)]
            );
            return rows[0];
        },

        async update(userId, tripId, trip) {
            const { rows } = await db.query(
                `UPDATE trips SET title = $1, destination = $2, start_date = $3, plan = $4::jsonb, updated_at = now()
                 WHERE id = $5 AND user_id = $6
                 RETURNING ${TRIP_COLUMNS}`,
                [trip.title, trip.destination, trip.startDate, JSON.stringify(trip.plan), tripId, userId]
            );
            return rows[0] || null;
        },

        async remove(userId, tripId) {
            const { rowCount } = await db.query('DELETE FROM trips WHERE id = $1 AND user_id = $2', [tripId, userId]);
            return rowCount > 0;
        }
    };
}

module.exports = { createUserRepository, createMarkerRepository, createVisitRepository, createTripRepository };
