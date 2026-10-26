'use strict';

// Organizations (ADR 0022, ADR 0029): members and roles, invitation links, employer rules, the
// business visits counted for them, and the audit log.
const { withTransaction } = require('./db/pool');

function createOrgRepository(db) {
    return {
        /** The traveler's organizations, with their role and the employer's rules. */
        async listForUser(userId) {
            const { rows } = await db.query(
                `SELECT o.id, o.name, ms.role, COALESCE(r.rules, '[]'::jsonb) AS rules
                 FROM memberships ms JOIN organizations o ON o.id = ms.organization_id
                 LEFT JOIN org_rules r ON r.organization_id = o.id
                 WHERE ms.user_id = $1 ORDER BY lower(o.name), o.id`,
                [userId]
            );
            return rows;
        },

        /** The traveler's role in an organization, or null when not a member. */
        async roleOf(userId, orgId) {
            const { rows } = await db.query('SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2', [userId, orgId]);
            return rows[0]?.role ?? null;
        },

        async countForUser(userId) {
            const { rows } = await db.query('SELECT count(*)::int AS count FROM memberships WHERE user_id = $1', [userId]);
            return rows[0].count;
        },

        /** A new organization, its creator its admin. */
        async create(userId, name) {
            return withTransaction(db, async client => {
                const { rows } = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id, name', [name]);
                await client.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin')", [rows[0].id, userId]);
                await client.query('INSERT INTO org_rules (organization_id) VALUES ($1)', [rows[0].id]);
                return { ...rows[0], role: 'admin', rules: [] };
            });
        },

        async rename(orgId, name) {
            await db.query('UPDATE organizations SET name = $2 WHERE id = $1', [orgId, name]);
        },

        async remove(orgId) {
            await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
        },

        async setRules(orgId, rules) {
            await db.query(
                `INSERT INTO org_rules (organization_id, rules) VALUES ($1, $2::jsonb)
                 ON CONFLICT (organization_id) DO UPDATE SET rules = EXCLUDED.rules, updated_at = now()`,
                [orgId, JSON.stringify(rules)]
            );
        },

        async rules(orgId) {
            const { rows } = await db.query('SELECT rules FROM org_rules WHERE organization_id = $1', [orgId]);
            return rows[0]?.rules ?? [];
        },

        /** Members by name, with their id for the report. */
        async listMembers(orgId) {
            const { rows } = await db.query(
                `SELECT u.id, u.username, ms.role, ms.joined_at AS "joinedAt"
                 FROM memberships ms JOIN users u ON u.id = ms.user_id
                 WHERE ms.organization_id = $1 ORDER BY lower(u.username)`,
                [orgId]
            );
            return rows;
        },

        async setRole(orgId, userId, role) {
            const { rowCount } = await db.query('UPDATE memberships SET role = $3 WHERE organization_id = $1 AND user_id = $2', [orgId, userId, role]);
            return rowCount > 0;
        },

        async removeMember(orgId, userId) {
            // Their business visits for it become personal again.
            return withTransaction(db, async client => {
                const { rowCount } = await client.query('DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2', [orgId, userId]);
                await client.query(
                    `UPDATE visits v SET organization_id = NULL FROM markers m
                     WHERE m.id = v.marker_id AND m.user_id = $2 AND v.organization_id = $1`,
                    [orgId, userId]
                );
                return rowCount > 0;
            });
        },

        async createInvitation(orgId, { role, tokenHash, createdBy, expiresAt }) {
            const { rows } = await db.query(
                `INSERT INTO invitations (organization_id, role, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, role, created_at AS "createdAt", expires_at AS "expiresAt"`,
                [orgId, role, tokenHash, createdBy, expiresAt]
            );
            return rows[0];
        },

        /** Invitations not used yet and not expired. */
        async listInvitations(orgId) {
            const { rows } = await db.query(
                `SELECT id, role, created_at AS "createdAt", expires_at AS "expiresAt" FROM invitations
                 WHERE organization_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
                [orgId]
            );
            return rows;
        },

        async revokeInvitation(orgId, id) {
            const { rowCount } = await db.query('DELETE FROM invitations WHERE organization_id = $1 AND id = $2 AND used_at IS NULL', [orgId, id]);
            return rowCount > 0;
        },

        /**
         * Joins with an invitation, once: the organization and the role kept (a member keeps
         * theirs); null when the token is unknown, used or expired.
         */
        async useInvitation(tokenHash, userId) {
            return withTransaction(db, async client => {
                const { rows } = await client.query(
                    `SELECT i.id, i.organization_id, i.role, o.name FROM invitations i JOIN organizations o ON o.id = i.organization_id
                     WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now() FOR UPDATE OF i`,
                    [tokenHash]
                );
                const invitation = rows[0];
                if (!invitation) return null;
                await client.query('UPDATE invitations SET used_at = now(), used_by = $2 WHERE id = $1', [invitation.id, userId]);
                await client.query(
                    'INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [invitation.organization_id, userId, invitation.role]
                );
                const { rows: [member] } = await client.query(
                    'SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2',
                    [invitation.organization_id, userId]
                );
                return { id: invitation.organization_id, name: invitation.name, role: member.role };
            });
        },

        /** The business visits members made for the organization, with their places' positions only. */
        async businessVisits(orgId, userIds) {
            const { rows } = await db.query(
                `SELECT m.user_id AS "userId", m.id AS "markerId", m.lat, m.lng, m.category, m.name,
                    v.id, v.start_date AS "startDate", v.end_date AS "endDate", v.ongoing
                 FROM visits v JOIN markers m ON m.id = v.marker_id
                 WHERE v.organization_id = $1 AND v.purpose = 'business' AND m.user_id = ANY($2::bigint[])`,
                [orgId, userIds]
            );
            return rows;
        },

        async audit(orgId, actorId, travelerIds, action) {
            if (!travelerIds.length) return;
            await db.query(
                'INSERT INTO audit_log (organization_id, actor_id, traveler_id, action) SELECT $1, $2, unnest($3::bigint[]), $4',
                [orgId, actorId, travelerIds, action]
            );
        },

        /** Who looked at a traveler's counts, newest first. */
        async auditFor(travelerId, limit = 100) {
            const { rows } = await db.query(
                `SELECT o.name AS organization, u.username AS actor, a.action, a.at
                 FROM audit_log a JOIN organizations o ON o.id = a.organization_id
                 LEFT JOIN users u ON u.id = a.actor_id
                 WHERE a.traveler_id = $1 ORDER BY a.at DESC, a.id DESC LIMIT $2`,
                [travelerId, limit]
            );
            return rows;
        }
    };
}

module.exports = { createOrgRepository };
