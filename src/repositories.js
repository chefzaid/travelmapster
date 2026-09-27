'use strict';

const MARKER_COLUMNS = `id, lat, lng, type, name, category,
    photo_url AS "photoUrl", notes, travel_date AS "travelDate"`;

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

        /** Deletes the account; markers and trips cascade. */
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
    return [marker.lat, marker.lng, marker.type, marker.name, marker.category,
        marker.photoUrl, marker.notes, marker.travelDate];
}

function createMarkerRepository(db) {
    return {
        async listForUser(userId) {
            const { rows } = await db.query(
                `SELECT ${MARKER_COLUMNS} FROM markers WHERE user_id = $1 ORDER BY id`,
                [userId]
            );
            return rows;
        },

        async create(userId, marker, client = db) {
            const { rows } = await client.query(
                `INSERT INTO markers (lat, lng, type, name, category, photo_url, notes, travel_date, user_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING ${MARKER_COLUMNS}`,
                [...markerValues(marker), userId]
            );
            return rows[0];
        },

        async update(userId, markerId, marker) {
            const { rows } = await db.query(
                `UPDATE markers SET lat = $1, lng = $2, type = $3, name = $4, category = $5,
                    photo_url = $6, notes = $7, travel_date = $8, updated_at = now()
                 WHERE id = $9 AND user_id = $10
                 RETURNING ${MARKER_COLUMNS}`,
                [...markerValues(marker), markerId, userId]
            );
            return rows[0] || null;
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

module.exports = { createUserRepository, createMarkerRepository, createTripRepository };
