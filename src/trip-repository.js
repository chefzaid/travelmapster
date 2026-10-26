'use strict';

// Trips (ADR 0028): a traveler's own trips and those shared with them, with their role in each,
// and the accounts a trip is shared with.

const TRIP_COLUMNS = `t.id, t.title, t.destination, t.start_date AS "startDate", t.plan, t.stops, t.packing, t.budget,
    t.organization_id AS "organizationId", t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;

// The traveler ($1) is the trip's owner, or a member who can edit or only view it.
const ACCESS = `${TRIP_COLUMNS},
    CASE WHEN t.user_id = $1 THEN 'owner' ELSE m.role END AS role,
    CASE WHEN t.user_id = $1 THEN NULL ELSE o.username END AS owner
    FROM trips t
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = $1
    JOIN users o ON o.id = t.user_id`;

const ORDER = 'ORDER BY COALESCE(t.start_date::timestamptz, t.created_at) DESC, t.id DESC';

function createTripRepository(db) {
    const repository = {
        /** The traveler's trips and those shared with them, each with `role` and `owner`. */
        async listForUser(userId) {
            const { rows } = await db.query(`SELECT ${ACCESS} WHERE t.user_id = $1 OR m.user_id IS NOT NULL ${ORDER}`, [userId]);
            return rows;
        },

        /** Only the traveler's own trips, as the account archive holds them. */
        async listOwned(userId) {
            const { rows } = await db.query(`SELECT ${TRIP_COLUMNS} FROM trips t WHERE t.user_id = $1 ${ORDER}`, [userId]);
            return rows;
        },

        /** A trip the traveler owns or is a member of, with their role; null otherwise. */
        async findForUser(userId, tripId) {
            const { rows } = await db.query(
                `SELECT ${ACCESS} WHERE t.id = $2 AND (t.user_id = $1 OR m.user_id IS NOT NULL)`,
                [userId, tripId]
            );
            return rows[0] || null;
        },

        async create(userId, trip) {
            const { rows } = await db.query(
                `INSERT INTO trips (user_id, title, destination, start_date, plan, stops, packing, budget, organization_id)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
                 RETURNING id`,
                [userId, trip.title, trip.destination, trip.startDate, JSON.stringify(trip.plan), JSON.stringify(trip.stops ?? []),
                    JSON.stringify(trip.packing ?? []), JSON.stringify(trip.budget ?? {}), trip.organizationId ?? null]
            );
            return repository.findForUser(userId, rows[0].id);
        },

        /**
         * Saves a trip its owner or an editor changed; stops, a packing list, a budget or an
         * organization left out keep the stored ones, and only the owner changes the
         * organization (ADR 0030). With `version` (the `updatedAt` it was edited from), a trip
         * saved by someone else since is left alone. Null when nothing was saved.
         */
        async update(userId, tripId, trip, version = null) {
            const json = value => (value ? JSON.stringify(value) : null);
            const { rowCount } = await db.query(
                `UPDATE trips t SET title = $1, destination = $2, start_date = $3, plan = $4::jsonb,
                     stops = COALESCE($5::jsonb, stops), packing = COALESCE($6::jsonb, packing),
                     budget = COALESCE($7::jsonb, budget),
                     organization_id = CASE WHEN $11::boolean AND t.user_id = $9 THEN $12::bigint ELSE t.organization_id END,
                     updated_at = now()
                 WHERE t.id = $8
                   AND (t.user_id = $9 OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = $9 AND m.role = 'edit'))
                   AND ($10::timestamptz IS NULL OR date_trunc('milliseconds', t.updated_at) = $10::timestamptz)`,
                [trip.title, trip.destination, trip.startDate, JSON.stringify(trip.plan),
                    json(trip.stops), json(trip.packing), json(trip.budget), tripId, userId, version,
                    trip.organizationId !== undefined, trip.organizationId ?? null]
            );
            return rowCount ? repository.findForUser(userId, tripId) : null;
        },

        /** Deletes a trip; only its owner can. */
        async remove(userId, tripId) {
            const { rowCount } = await db.query('DELETE FROM trips WHERE id = $1 AND user_id = $2', [tripId, userId]);
            return rowCount > 0;
        },

        /** The accounts a trip is shared with, in the order they were added. */
        async listMembers(tripId) {
            const { rows } = await db.query(
                `SELECT u.username, m.role, m.added_at AS "addedAt" FROM trip_members m JOIN users u ON u.id = m.user_id
                 WHERE m.trip_id = $1 ORDER BY m.added_at, u.username`,
                [tripId]
            );
            return rows;
        },

        /** Shares a trip with an account, or changes its role. */
        async setMember(tripId, userId, role) {
            await db.query(
                `INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, $3)
                 ON CONFLICT (trip_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
                [tripId, userId, role]
            );
        },

        async removeMember(tripId, userId) {
            const { rowCount } = await db.query('DELETE FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
            return rowCount > 0;
        }
    };
    return repository;
}

module.exports = { createTripRepository };
