'use strict';

const { createTripRepository } = require('./trip-repository');
const { browserModule } = require('./browser-modules');

// The legacy travel date is derived from the visits. The app no longer reads or writes
// markers.travel_date; triggers keep it in step for the previous release until the column
// is dropped (ADR 0009).
const MARKER_COLUMNS = `m.id, m.lat, m.lng, m.type, m.name, m.category,
    m.photo_url AS "photoUrl", m.notes, m.rating, m.tags, m.emoji, m.hide_from_public AS "hideFromPublic",
    m.priority, m.best_months AS "bestMonths",
    -- The previous release can move a lived-in place to the wishlist without resetting it (ADR 0014).
    CASE WHEN m.type = 'visited' THEN m.stay ELSE 'visit' END AS stay,
    (SELECT max(v.start_date) FROM visits v WHERE v.marker_id = m.id) AS "travelDate",
    COALESCE((SELECT json_agg(json_build_object(
        'id', v.id, 'startDate', v.start_date, 'endDate', v.end_date, 'ongoing', v.ongoing,
        'notes', v.notes, 'photoUrl', v.photo_url, 'purpose', v.purpose, 'organizationId', v.organization_id)
        ORDER BY v.start_date DESC, v.id DESC)
        FROM visits v WHERE v.marker_id = m.id), '[]'::json) AS visits`;

const VISIT_COLUMNS = `v.id, v.start_date AS "startDate", v.end_date AS "endDate", v.ongoing,
    v.notes, v.photo_url AS "photoUrl", v.purpose, v.organization_id AS "organizationId"`;

// Account settings by API field and column.
// Goals and packing templates are JSON, so they are written as text and cast.
const PROFILE_COLUMNS = [
    ['profileVisibility', 'profile_visibility'], ['homeCountry', 'home_country'], ['countryList', 'country_list'],
    ['mapPalette', 'map_palette'], ['publicJourneys', 'public_journeys'], ['publicIndexing', 'public_indexing'],
    ['goals', 'goals', 'jsonb'], ['packingTemplates', 'packing_templates', 'jsonb']
];
const USER_COLUMNS = 'id, username, profile_visibility, home_country, country_list, map_palette, public_journeys, public_indexing, goals, packing_templates';

function createUserRepository(db) {
    return {
        async findByUsername(username) {
            const { rows } = await db.query(
                `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(username) = lower($1)`,
                [username]
            );
            return rows[0] || null;
        },

        /** The user, with `seen_today` telling whether their activity day is already recorded. */
        async findById(id) {
            const { rows } = await db.query(
                `SELECT ${USER_COLUMNS}, last_seen_on, last_seen_on IS NOT DISTINCT FROM current_date AS seen_today FROM users WHERE id = $1`,
                [id]
            );
            return rows[0] || null;
        },

        /** Records today as the user's last active day (a date only, for activity metrics). */
        async markSeen(id) {
            await db.query('UPDATE users SET last_seen_on = current_date WHERE id = $1 AND last_seen_on IS DISTINCT FROM current_date', [id]);
        },

        /** Names of the public maps whose owners let search engines list them, for the sitemap. */
        async listIndexed(limit = 10_000) {
            const { rows } = await db.query(
                `SELECT username FROM users WHERE profile_visibility = 'public' AND public_indexing
                 ORDER BY lower(username) LIMIT $1`,
                [limit]
            );
            return rows.map(row => row.username);
        },

        /** Accounts in total and by how recently they were used, for the metrics endpoint. */
        async activity() {
            const { rows } = await db.query(
                `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE last_seen_on >= current_date)::int AS active_1d,
                    count(*) FILTER (WHERE last_seen_on > current_date - 7)::int AS active_7d,
                    count(*) FILTER (WHERE last_seen_on > current_date - 30)::int AS active_30d,
                    count(*) FILTER (WHERE last_seen_on > current_date - 7 AND created_at < now() - interval '30 days')::int AS returning_7d
                 FROM users`
            );
            return rows[0];
        },

        /** Returns the new user, or null when the username is already taken. */
        async create(username, passwordHash) {
            const { rows } = await db.query(
                `INSERT INTO users (username, password_hash) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING
                 RETURNING ${USER_COLUMNS}`,
                [username, passwordHash]
            );
            return rows[0] || null;
        },

        /** Writes only the settings given, and returns them all. */
        async updateProfile(id, profile) {
            const values = [id];
            let set = '';
            for (const [field, column, cast] of PROFILE_COLUMNS) {
                if (profile[field] === undefined) continue;
                values.push(cast ? JSON.stringify(profile[field]) : profile[field]);
                set += `${column} = $${values.length}${cast ? `::${cast}` : ''}, `;
            }
            const { rows } = await db.query(
                `UPDATE users SET ${set}updated_at = now() WHERE id = $1
                 RETURNING profile_visibility AS "profileVisibility", home_country AS "homeCountry",
                    country_list AS "countryList", map_palette AS "mapPalette", public_journeys AS "publicJourneys",
                    public_indexing AS "publicIndexing", goals, packing_templates AS "packingTemplates"`,
                values
            );
            return rows[0] || null;
        },

        async findPasswordHash(id) {
            const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [id]);
            return rows[0]?.password_hash || null;
        },

        async setPasswordHash(id, passwordHash) {
            await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, id]);
        },

        /** Deletes the account; markers (with their visits), trips and ledger data cascade. */
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

// Optional place details (ADR 0012, 0013) by API field, column and default. An update writes
// only the fields it was sent, so older clients that do not know them keep what is stored.
/** @type {Array<[string, string, null | boolean | string | any[]]>} */
const DETAIL_COLUMNS = [
    ['rating', 'rating', null], ['tags', 'tags', []], ['emoji', 'emoji', null], ['hideFromPublic', 'hide_from_public', false],
    ['priority', 'priority', null], ['bestMonths', 'best_months', []], ['stay', 'stay', 'visit']
];

function visitValues(visit) {
    return [visit.startDate, visit.endDate, visit.notes, visit.photoUrl, visit.ongoing];
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

        async count(userId) {
            const { rows } = await db.query('SELECT count(*)::int AS count FROM markers WHERE user_id = $1', [userId]);
            return rows[0].count;
        },

        /** The places a public map may show: never those the traveler hid (ADR 0013). */
        async listPublic(userId) {
            const { rows } = await db.query(
                `SELECT ${MARKER_COLUMNS} FROM markers m WHERE m.user_id = $1 AND NOT m.hide_from_public ORDER BY m.id`,
                [userId]
            );
            return rows;
        },

        /**
         * Creates a place with its visits; run it in a transaction when it has visits.
         * Without a visits list, a legacy travel date becomes the first visit.
         */
        async create(userId, marker, client = db) {
            const details = DETAIL_COLUMNS.map(([field, , fallback]) => marker[field] ?? fallback);
            const { rows } = await client.query(
                `INSERT INTO markers (lat, lng, type, name, category, photo_url, notes, user_id,
                    ${DETAIL_COLUMNS.map(([, column]) => column).join(', ')})
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${details.map((_, i) => `$${i + 9}`).join(', ')})
                 RETURNING id`,
                [...markerValues(marker), userId, ...details]
            );
            const legacyVisit = marker.travelDate ? [{ startDate: marker.travelDate, endDate: null, notes: null, photoUrl: null, ongoing: false }] : [];
            for (const visit of marker.visits || legacyVisit) {
                await client.query(
                    `INSERT INTO visits (marker_id, start_date, end_date, notes, photo_url, ongoing)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [rows[0].id, ...visitValues(visit)]
                );
            }
            return find(userId, rows[0].id, client);
        },

        /**
         * Fields left out keep what is stored. A travel date sent the legacy way only ever adds
         * a visit, unless one already starts that day; clearing it keeps every visit.
         */
        async update(userId, markerId, marker) {
            const values = [...markerValues(marker), markerId, userId];
            let setOptional = '';
            for (const [field, column] of DETAIL_COLUMNS) {
                if (marker[field] === undefined) continue;
                values.push(marker[field]);
                setOptional += `, ${column} = $${values.length}`;
            }
            const { rowCount } = await db.query(
                `UPDATE markers SET lat = $1, lng = $2, type = $3, name = $4, category = $5,
                    photo_url = $6, notes = $7${setOptional}, updated_at = now()
                 WHERE id = $8 AND user_id = $9`,
                values
            );
            if (!rowCount) return null;
            if (marker.travelDate) {
                await db.query(
                    `INSERT INTO visits (marker_id, start_date) SELECT $1, $2
                     WHERE NOT EXISTS (SELECT 1 FROM visits WHERE marker_id = $1 AND start_date = $2)`,
                    [markerId, marker.travelDate]
                );
            }
            return find(userId, markerId);
        },

        /**
         * Merges `otherId` into `keepId` inside the caller's transaction: the kept place takes the
         * other's visits (ids and date history unchanged) and the details it lacks, and the other
         * is removed. Resolves to the kept place, or null when either is missing or someone else's.
         */
        async merge(userId, keepId, otherId, client) {
            const { rows } = await client.query(
                'SELECT id FROM markers WHERE id = ANY($1::bigint[]) AND user_id = $2 FOR UPDATE',
                [[keepId, otherId], userId]
            );
            if (rows.length !== 2) return null;
            const [keep, other] = [await find(userId, keepId, client), await find(userId, otherId, client)];
            // The browser's own rules, so a guest map merges alike (public/js/place-merge.js).
            const { mergedDetails } = await browserModule('place-merge.js');
            const merged = mergedDetails(keep, other);
            const details = DETAIL_COLUMNS.map(([field]) => merged[field]);
            await client.query(
                `UPDATE markers SET lat = $1, lng = $2, type = $3, name = $4, category = $5, photo_url = $6, notes = $7,
                    ${DETAIL_COLUMNS.map(([, column], i) => `${column} = $${i + 10}`).join(', ')}, updated_at = now()
                 WHERE id = $8 AND user_id = $9`,
                [...markerValues(merged), keepId, userId, ...details]
            );
            await client.query('UPDATE visits SET marker_id = $1 WHERE marker_id = $2', [keepId, otherId]);
            await client.query('DELETE FROM markers WHERE id = $1 AND user_id = $2', [otherId, userId]);
            return find(userId, keepId, client);
        },

        async remove(userId, markerId) {
            const { rowCount } = await db.query(
                'DELETE FROM markers WHERE id = $1 AND user_id = $2',
                [markerId, userId]
            );
            return rowCount > 0;
        },

        /**
         * Applies a bulk change inside the caller's transaction. Throws a NOT_FOUND error when
         * any place to change or remove is missing or someone else's, so nothing is kept.
         */
        async applyBulk(userId, { create, update, remove }, client) {
            const notFound = () => Object.assign(new Error('Some places were not found.'), { code: 'NOT_FOUND' });
            if (update.length) {
                // A stay left out (null) keeps the stored one.
                const { rowCount } = await client.query(
                    `UPDATE markers m SET type = u.type, stay = COALESCE(u.stay, m.stay), updated_at = now()
                     FROM unnest($1::bigint[], $2::text[], $3::text[]) AS u(id, type, stay)
                     WHERE m.id = u.id AND m.user_id = $4`,
                    [update.map(item => item.id), update.map(item => item.type), update.map(item => item.stay ?? null), userId]
                );
                if (rowCount !== update.length) throw notFound();
            }
            if (remove.length) {
                const { rowCount } = await client.query(
                    'DELETE FROM markers WHERE id = ANY($1::bigint[]) AND user_id = $2',
                    [remove, userId]
                );
                if (rowCount !== remove.length) throw notFound();
            }
            const created = [];
            for (const marker of create) created.push(await this.create(userId, marker, client));
            const { rows: updated } = update.length
                ? await client.query(
                    `SELECT ${MARKER_COLUMNS} FROM markers m WHERE m.user_id = $1 AND m.id = ANY($2::bigint[]) ORDER BY m.id`,
                    [userId, update.map(item => item.id)])
                : { rows: [] };
            return { created, updated, removed: remove };
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
                `INSERT INTO visits AS v (marker_id, start_date, end_date, notes, photo_url, ongoing, purpose, organization_id)
                 SELECT m.id, $3, $4, $5, $6, $7, COALESCE($8, 'personal'), $9 FROM markers m WHERE m.id = $1 AND m.user_id = $2
                 RETURNING ${VISIT_COLUMNS}`,
                [markerId, userId, ...visitValues(visit), visit.purpose ?? null, visit.organizationId ?? null]
            );
            return rows[0] || null;
        },

        // A purpose left out keeps the stored one and its organization (ADR 0029).
        async update(userId, visitId, visit) {
            const { rows } = await db.query(
                `UPDATE visits v SET start_date = $3, end_date = $4, notes = $5, photo_url = $6, ongoing = $7,
                    purpose = COALESCE($8, v.purpose),
                    organization_id = CASE WHEN $8::text IS NULL THEN v.organization_id ELSE $9::bigint END,
                    updated_at = now()
                 FROM markers m
                 WHERE v.id = $1 AND m.id = v.marker_id AND m.user_id = $2
                 RETURNING ${VISIT_COLUMNS}`,
                [visitId, userId, ...visitValues(visit), visit.purpose ?? null, visit.organizationId ?? null]
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

const LEDGER_DEFAULTS = Object.freeze({ dayRule: 'presence', rules: [], planned: [], exempt: [] });

const CHANGE_COLUMNS = `id, visit_id AS "visitId", marker_id AS "markerId", place_name AS "placeName", action,
    old_start_date AS "oldStartDate", old_end_date AS "oldEndDate", old_ongoing AS "oldOngoing",
    new_start_date AS "newStartDate", new_end_date AS "newEndDate", new_ongoing AS "newOngoing",
    changed_at AS "changedAt"`;

/** Day-ledger settings and the history of visit dates, both scoped to their owner. */
function createLedgerRepository(db) {
    return {
        /** The traveler's settings, or the defaults until they first save. */
        async findSettings(userId) {
            const { rows } = await db.query(
                `SELECT day_rule AS "dayRule", rules, planned, exempt, updated_at AS "updatedAt"
                 FROM ledger_settings WHERE user_id = $1`,
                [userId]
            );
            return rows[0] || { ...LEDGER_DEFAULTS, updatedAt: null };
        },

        /** Saves the settings; `firstSave` tells whether the traveler had none before. */
        async saveSettings(userId, settings) {
            const { rows } = await db.query(
                `INSERT INTO ledger_settings (user_id, day_rule, rules, planned, exempt)
                 VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
                 ON CONFLICT (user_id) DO UPDATE SET day_rule = EXCLUDED.day_rule, rules = EXCLUDED.rules,
                    planned = EXCLUDED.planned, exempt = EXCLUDED.exempt, updated_at = now()
                 RETURNING day_rule AS "dayRule", rules, planned, exempt, updated_at AS "updatedAt", (xmax = 0) AS "firstSave"`,
                [userId, settings.dayRule, JSON.stringify(settings.rules), JSON.stringify(settings.planned), JSON.stringify(settings.exempt || [])]
            );
            const { firstSave, ...saved } = rows[0];
            return { settings: saved, firstSave };
        },

        /** Newest first, at most `limit` (null for all); written by triggers on visits and places (migration 005). */
        async listChanges(userId, limit) {
            const { rows } = await db.query(
                `SELECT ${CHANGE_COLUMNS} FROM visit_changes WHERE user_id = $1
                 ORDER BY changed_at DESC, id DESC LIMIT $2`,
                [userId, limit]
            );
            return rows;
        }
    };
}

module.exports = {
    createUserRepository,
    createMarkerRepository,
    createVisitRepository,
    createLedgerRepository,
    // Trips, with the accounts they are shared with, live in trip-repository.js (ADR 0028).
    createTripRepository
};
