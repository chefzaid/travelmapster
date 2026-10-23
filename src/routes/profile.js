'use strict';

const express = require('express');
const { USERNAME_PATTERN, parseProfile } = require('../validation');

function createProfileRouter({ users }) {
    const router = express.Router();

    // Each setting is optional: the previous release's tabs send only profileVisibility.
    router.patch('/', async (req, res) => {
        const { profile, error } = parseProfile(req.body);
        if (error) return res.status(400).json({ error });
        return res.json(await users.updateProfile(req.user.id, profile));
    });

    return router;
}

/** Read-only view of a user's map, available only when they chose "public". */
function createPublicProfileRouter({ users, markers }) {
    const router = express.Router();

    router.get('/:username', async (req, res) => {
        const username = String(req.params.username);
        const user = USERNAME_PATTERN.test(username) ? await users.findByUsername(username) : null;
        // Private and missing profiles are indistinguishable to callers.
        if (!user || user.profile_visibility !== 'public') {
            return res.status(404).json({ error: 'Profile not found.' });
        }
        const places = await markers.listPublic(user.id);
        res.set('Cache-Control', 'no-store');
        return res.json({
            username: user.username,
            // The owner's list, so visitors see the same counts (ADR 0015).
            countryList: user.country_list || 'all',
            // The home country stays private: it says where the traveler lives now (ADR 0014).
            markers: places.map(({ id, lat, lng, type, stay, name, category, travelDate, visits }) => ({
                // Personal notes and photo links, of places and visits, and ratings, tags and
                // emoji stay private even on public profiles: only the visit dates are shared.
                // Places the traveler hid are not listed at all (ADR 0013).
                id, lat, lng, type, stay, name, category, travelDate,
                visits: visits.map(({ startDate, endDate }) => ({ startDate, endDate }))
            }))
        });
    });

    return router;
}

module.exports = { createProfileRouter, createPublicProfileRouter };
