'use strict';

// Organizations (ADR 0022, ADR 0029): creating and running one, invitation links, employer
// rules, the business-day report and the audit log members read about themselves.
const crypto = require('node:crypto');
const express = require('express');
const { USERNAME_PATTERN, normalizeText, parseMarkerId } = require('../validation');
const { parseLedgerRules } = require('../ledger-validation');
const { orgReport, parsePeriod, yearOf } = require('../org-report');

const ROLES = new Set(['traveler', 'manager', 'admin']);
const MAX_ORGS = 10;
const NAME_MAX_LENGTH = 80;
const INVITATION_DAYS = 7;

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

// Running an organization needs more than a password (ADR 0027, ADR 0029).
const SECOND_FACTOR = {
    error: 'Add a passkey or turn on two-step sign-in (Sign-in security) to run an organization.',
    code: 'second_factor_required'
};

function createOrgRouter({ orgs, users, security }) {
    const router = express.Router();

    // The organization in the path when the traveler has one of `allowed` roles in it.
    async function orgFor(req, res, allowed = ROLES) {
        const orgId = parseMarkerId(req.params.id);
        if (!orgId) {
            res.status(400).json({ error: 'Invalid organization id.' });
            return null;
        }
        const role = await orgs.roleOf(req.user.id, orgId);
        if (!role) {
            res.status(404).json({ error: 'Organization not found.' });
            return null;
        }
        if (!allowed.has(role)) {
            res.status(403).json({ error: role === 'traveler' ? 'Only its managers and admins can do this.' : 'Only its admins can do this.' });
            return null;
        }
        if (allowed !== ROLES && !(await security.hasSecondFactor(req.user.id))) {
            res.status(403).json(SECOND_FACTOR);
            return null;
        }
        return { id: orgId, role };
    }
    const MANAGERS = new Set(['manager', 'admin']);
    const ADMINS = new Set(['admin']);

    const readName = body => {
        const name = normalizeText(body?.name);
        return name && name.length <= NAME_MAX_LENGTH ? name : null;
    };

    router.get('/', async (req, res) => {
        res.json(await orgs.listForUser(req.user.id));
    });

    router.post('/', async (req, res) => {
        const name = readName(req.body);
        if (!name) return res.status(400).json({ error: `Name the organization in 1 to ${NAME_MAX_LENGTH} characters.` });
        if (await orgs.countForUser(req.user.id) >= MAX_ORGS) return res.status(409).json({ error: `An account belongs to at most ${MAX_ORGS} organizations.` });
        if (!(await security.hasSecondFactor(req.user.id))) return res.status(403).json(SECOND_FACTOR);
        return res.status(201).json(await orgs.create(req.user.id, name));
    });

    // Who looked at the traveler's counts, from every organization (ADR 0022).
    router.get('/audit', async (req, res) => {
        res.json(await orgs.auditFor(req.user.id));
    });

    router.post('/join', async (req, res) => {
        const token = normalizeText(req.body?.token);
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(400).json({ error: 'That invitation link is not complete.' });
        if (await orgs.countForUser(req.user.id) >= MAX_ORGS) return res.status(409).json({ error: `An account belongs to at most ${MAX_ORGS} organizations.` });
        const org = await orgs.useInvitation(hashToken(token), req.user.id);
        if (!org) return res.status(404).json({ error: 'This invitation was used already or has expired. Ask for a new link.' });
        return res.json(org);
    });

    router.patch('/:id', async (req, res) => {
        const org = await orgFor(req, res, ADMINS);
        if (!org) return undefined;
        const name = readName(req.body);
        if (!name) return res.status(400).json({ error: `Name the organization in 1 to ${NAME_MAX_LENGTH} characters.` });
        await orgs.rename(org.id, name);
        return res.json({ id: org.id, name });
    });

    router.delete('/:id', async (req, res) => {
        const org = await orgFor(req, res, ADMINS);
        if (!org) return undefined;
        await orgs.remove(org.id);
        return res.status(204).end();
    });

    router.put('/:id/rules', async (req, res) => {
        const org = await orgFor(req, res, ADMINS);
        if (!org) return undefined;
        const { rules, error } = parseLedgerRules(req.body?.rules);
        if (error) return res.status(400).json({ error });
        await orgs.setRules(org.id, rules);
        return res.json({ rules });
    });

    // ---- members

    router.get('/:id/members', async (req, res) => {
        const org = await orgFor(req, res, MANAGERS);
        if (!org) return undefined;
        return res.json((await orgs.listMembers(org.id)).map(({ username, role, joinedAt }) => ({ username, role, joinedAt })));
    });

    // An organization always keeps an admin.
    async function lastAdmin(orgId, userId) {
        const members = await orgs.listMembers(orgId);
        const admins = members.filter(member => member.role === 'admin');
        return admins.length === 1 && admins[0].id === userId;
    }

    async function memberByName(orgId, name) {
        if (!USERNAME_PATTERN.test(String(name))) return null;
        const user = await users.findByUsername(String(name));
        return user && (await orgs.roleOf(user.id, orgId)) ? user : null;
    }

    router.patch('/:id/members/:username', async (req, res) => {
        const org = await orgFor(req, res, ADMINS);
        if (!org) return undefined;
        const role = req.body?.role;
        if (!ROLES.has(role)) return res.status(400).json({ error: 'Role must be traveler, manager or admin.' });
        const member = await memberByName(org.id, req.params.username);
        if (!member) return res.status(404).json({ error: 'Not a member.' });
        if (role !== 'admin' && await lastAdmin(org.id, member.id)) return res.status(409).json({ error: 'An organization needs an admin: make someone else admin first.' });
        await orgs.setRole(org.id, member.id, role);
        return res.json({ username: member.username, role });
    });

    // An admin removes a member; anyone leaves, but the last admin.
    router.delete('/:id/members/:username', async (req, res) => {
        const leaving = String(req.params.username).toLowerCase() === req.user.username.toLowerCase();
        const org = await orgFor(req, res, leaving ? ROLES : ADMINS);
        if (!org) return undefined;
        const member = await memberByName(org.id, req.params.username);
        if (!member) return res.status(404).json({ error: 'Not a member.' });
        if (await lastAdmin(org.id, member.id)) return res.status(409).json({ error: 'An organization needs an admin: make someone else admin first, or delete it.' });
        await orgs.removeMember(org.id, member.id);
        return res.status(204).end();
    });

    // ---- invitations

    router.get('/:id/invitations', async (req, res) => {
        const org = await orgFor(req, res, ADMINS);
        if (!org) return undefined;
        return res.json(await orgs.listInvitations(org.id));
    });

    // The token is shown once; only its hash is kept.
    router.post('/:id/invitations', async (req, res) => {
        const org = await orgFor(req, res, ADMINS);
        if (!org) return undefined;
        const role = req.body?.role ?? 'traveler';
        if (!ROLES.has(role)) return res.status(400).json({ error: 'Role must be traveler, manager or admin.' });
        const token = crypto.randomBytes(24).toString('base64url');
        const invitation = await orgs.createInvitation(org.id, {
            role, tokenHash: hashToken(token), createdBy: req.user.id, expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000)
        });
        return res.status(201).json({ ...invitation, token });
    });

    router.delete('/:id/invitations/:invitationId', async (req, res) => {
        const org = await orgFor(req, res, ADMINS);
        if (!org) return undefined;
        const invitationId = parseMarkerId(req.params.invitationId);
        if (!invitationId || !(await orgs.revokeInvitation(org.id, invitationId))) return res.status(404).json({ error: 'Invitation not found.' });
        return res.status(204).end();
    });

    // ---- the report

    router.get('/:id/report', async (req, res) => {
        const org = await orgFor(req, res, MANAGERS);
        if (!org) return undefined;
        const period = req.query.from || req.query.to ? parsePeriod(req.query.from, req.query.to) : yearOf();
        if (!period) return res.status(400).json({ error: 'The period needs a start and an end date (YYYY-MM-DD), at most ten years apart.' });
        const members = await orgs.listMembers(org.id);
        const [visits, rules] = await Promise.all([orgs.businessVisits(org.id, members.map(member => member.id)), orgs.rules(org.id)]);
        const rows = await orgReport({ members, visits, rules, ...period });
        // Every look at the counts is on the record, for each member shown.
        await orgs.audit(org.id, req.user.id, members.map(member => member.id), 'viewed business-day counts');
        res.set('Cache-Control', 'no-store');
        return res.json({ ...period, rules, members: rows });
    });

    return router;
}

/** Whether the traveler may mark a visit as business for that organization. */
async function checkVisitPurpose(orgs, userId, visit) {
    if (visit.purpose !== 'business') return null;
    return (await orgs.roleOf(userId, visit.organizationId)) ? null : 'You can only mark visits as business for your own organizations.';
}

module.exports = { checkVisitPurpose, createOrgRouter, hashToken };
