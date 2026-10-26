'use strict';

const express = require('express');
const { USERNAME_PATTERN, parseMarkerId, parseTripPayload } = require('../validation');
const { checkTripOrganization } = require('./orgs');

const MEMBER_ROLES = new Set(['edit', 'view']);
const MAX_MEMBERS = 20;

// The UI treats a missing start date as an empty string.
function toClientTrip(trip) {
    return { ...trip, startDate: trip.startDate || '' };
}

function createTripRouter({ trips, users, orgs }) {
    const router = express.Router();

    // The trip in the path, when the traveler owns it or it is shared with them.
    async function tripFor(req, res) {
        const tripId = parseMarkerId(req.params.id);
        if (!tripId) {
            res.status(400).json({ error: 'Invalid trip id.' });
            return null;
        }
        const trip = await trips.findForUser(req.user.id, tripId);
        if (!trip) res.status(404).json({ error: 'Trip not found.' });
        return trip;
    }

    router.get('/', async (req, res) => {
        res.json((await trips.listForUser(req.user.id)).map(toClientTrip));
    });

    router.post('/', async (req, res) => {
        const { trip, error } = parseTripPayload(req.body);
        if (error) return res.status(400).json({ error });
        const notMember = await checkTripOrganization(orgs, req.user.id, trip);
        if (notMember) return res.status(400).json({ error: notMember });
        return res.status(201).json(toClientTrip(await trips.create(req.user.id, trip)));
    });

    // Owners and editors save; a save from an older copy than the stored one is refused (ADR 0028).
    router.put('/:id', async (req, res) => {
        const tripId = parseMarkerId(req.params.id);
        if (!tripId) return res.status(400).json({ error: 'Invalid trip id.' });
        const { trip, error } = parseTripPayload(req.body);
        if (error) return res.status(400).json({ error });
        // Editors of a shared trip send the owner's organization back; only the owner's counts.
        const existing = trip.organizationId ? await trips.findForUser(req.user.id, tripId) : null;
        if (existing?.role === 'owner') {
            const notMember = await checkTripOrganization(orgs, req.user.id, trip);
            if (notMember) return res.status(400).json({ error: notMember });
        }
        const version = typeof req.body.updatedAt === 'string' && !Number.isNaN(Date.parse(req.body.updatedAt)) ? req.body.updatedAt : null;
        const updated = await trips.update(req.user.id, tripId, trip, version);
        if (updated) return res.json(toClientTrip(updated));
        const current = await trips.findForUser(req.user.id, tripId);
        if (!current) return res.status(404).json({ error: 'Trip not found.' });
        if (current.role === 'view') return res.status(403).json({ error: 'You can view this trip but not change it.' });
        return res.status(409).json({ error: 'Someone else saved this trip in the meantime. Their version is shown now; make your changes again.', trip: toClientTrip(current) });
    });

    router.delete('/:id', async (req, res) => {
        const trip = await tripFor(req, res);
        if (!trip) return undefined;
        if (trip.role !== 'owner') return res.status(403).json({ error: 'Only the trip\'s owner can delete it. Leave it instead.' });
        await trips.remove(req.user.id, trip.id);
        return res.status(204).end();
    });

    // ---- the accounts a trip is shared with

    router.get('/:id/members', async (req, res) => {
        const trip = await tripFor(req, res);
        if (!trip) return undefined;
        return res.json(await trips.listMembers(trip.id));
    });

    // Adds an account by username, or changes its role; only the owner shares.
    router.put('/:id/members/:username', async (req, res) => {
        const trip = await tripFor(req, res);
        if (!trip) return undefined;
        if (trip.role !== 'owner') return res.status(403).json({ error: 'Only the trip\'s owner can share it.' });
        const role = req.body?.role;
        if (!MEMBER_ROLES.has(role)) return res.status(400).json({ error: 'Role must be edit or view.' });
        const name = String(req.params.username);
        const member = USERNAME_PATTERN.test(name) ? await users.findByUsername(name) : null;
        if (!member) return res.status(404).json({ error: 'No account by that name.' });
        if (member.id === req.user.id) return res.status(400).json({ error: 'You own this trip already.' });
        const members = await trips.listMembers(trip.id);
        if (members.length >= MAX_MEMBERS && !members.some(item => item.username === member.username)) {
            return res.status(409).json({ error: `Share a trip with at most ${MAX_MEMBERS} people.` });
        }
        await trips.setMember(trip.id, member.id, role);
        return res.json(await trips.listMembers(trip.id));
    });

    // The owner removes a member; a member leaves.
    router.delete('/:id/members/:username', async (req, res) => {
        const trip = await tripFor(req, res);
        if (!trip) return undefined;
        const name = String(req.params.username);
        const leaving = name.toLowerCase() === req.user.username.toLowerCase();
        if (trip.role !== 'owner' && !leaving) return res.status(403).json({ error: 'Only the trip\'s owner can remove people.' });
        const member = USERNAME_PATTERN.test(name) ? await users.findByUsername(name) : null;
        if (!member || !(await trips.removeMember(trip.id, member.id))) return res.status(404).json({ error: 'Not shared with that account.' });
        return res.status(204).end();
    });

    return router;
}

module.exports = { createTripRouter };
