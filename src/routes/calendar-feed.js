'use strict';

// The signed-in traveler's calendar subscription (src/calendar-feed.js): whether it is on, a new
// private link (shown once, ending the old one), or turning it off.
const crypto = require('node:crypto');
const express = require('express');
const { hashToken } = require('../calendar-feed');
const { siteOrigin } = require('../seo');

/** The signed-in traveler's feed: whether it is on, a new link (shown once), or turning it off. */
function createCalendarFeedRouter({ feeds, config }) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        const feed = await feeds.find(req.user.id);
        res.json({ active: Boolean(feed), createdAt: feed?.createdAt ?? null });
    });
    router.post('/', async (req, res) => {
        const token = crypto.randomBytes(32).toString('base64url');
        const { createdAt } = await feeds.replace(req.user.id, hashToken(token));
        res.set('Cache-Control', 'no-store');
        res.status(201).json({ url: `${siteOrigin(config, req)}/calendar/${token}.ics`, createdAt });
    });
    router.delete('/', async (req, res) => {
        await feeds.remove(req.user.id);
        res.status(204).end();
    });
    return router;
}

module.exports = { createCalendarFeedRouter };
