'use strict';

// Following public maps (ADR 0028): one-way and silent, public maps only.
const express = require('express');
const { USERNAME_PATTERN } = require('../validation');

const MAX_FOLLOWS = 200;

function createFollowRouter({ users, follows }) {
    const router = express.Router();
    // Private and missing maps look the same to callers.
    const notFound = res => res.status(404).json({ error: 'No public map by that name.' });
    const findUser = async name => (USERNAME_PATTERN.test(String(name ?? '')) ? users.findByUsername(String(name)) : null);

    router.get('/', async (req, res) => {
        res.json(await follows.list(req.user.id));
    });

    router.post('/', async (req, res) => {
        const user = await findUser(req.body?.username);
        if (!user || user.profile_visibility !== 'public') return notFound(res);
        if (user.id === req.user.id) return res.status(400).json({ error: 'That is your own map.' });
        if (await follows.count(req.user.id) >= MAX_FOLLOWS) return res.status(409).json({ error: `Follow at most ${MAX_FOLLOWS} maps.` });
        await follows.follow(req.user.id, user.id);
        return res.status(201).json({ username: user.username, public: true });
    });

    router.delete('/:username', async (req, res) => {
        const user = await findUser(req.params.username);
        if (!user || !(await follows.unfollow(req.user.id, user.id))) return res.status(404).json({ error: 'You do not follow that map.' });
        return res.status(204).end();
    });

    return router;
}

module.exports = { createFollowRouter };
