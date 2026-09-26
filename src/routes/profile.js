'use strict';

const express = require('express');
const { USERNAME_PATTERN, parseProfileVisibility } = require('../validation');

function createProfileRouter({ users }) {
    const router = express.Router();

    router.patch('/', async (req, res) => {
        const { profileVisibility, error } = parseProfileVisibility(req.body);
        if (error) return res.status(400).json({ error });
        await users.setProfileVisibility(req.user.id, profileVisibility);
        return res.json({ profileVisibility });
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
        const places = await markers.listForUser(user.id);
        res.set('Cache-Control', 'no-store');
        return res.json({
            username: user.username,
            markers: places.map(({ id, lat, lng, type, name, category, travelDate }) => (
                // Personal notes and photo links stay private even on public profiles.
                { id, lat, lng, type, name, category, travelDate }
            ))
        });
    });

    return router;
}

module.exports = { createProfileRouter, createPublicProfileRouter };
