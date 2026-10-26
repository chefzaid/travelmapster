'use strict';

// Public maps a traveler follows (ADR 0028).

function createFollowRepository(db) {
    return {
        /** The maps followed, by name, with whether each is still public. */
        async list(userId) {
            const { rows } = await db.query(
                `SELECT u.username, u.profile_visibility = 'public' AS public, f.created_at AS since
                 FROM follows f JOIN users u ON u.id = f.followee_id
                 WHERE f.follower_id = $1 ORDER BY lower(u.username)`,
                [userId]
            );
            return rows;
        },

        async count(userId) {
            const { rows } = await db.query('SELECT count(*)::int AS count FROM follows WHERE follower_id = $1', [userId]);
            return rows[0].count;
        },

        async follow(userId, followeeId) {
            await db.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, followeeId]);
        },

        async unfollow(userId, followeeId) {
            const { rowCount } = await db.query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [userId, followeeId]);
            return rowCount > 0;
        }
    };
}

module.exports = { createFollowRepository };
