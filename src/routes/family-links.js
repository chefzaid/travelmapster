'use strict';

// Family view of a trip (src/family-links.js): the owner's link to it, made, replaced or ended,
// and the read-only view anyone with the link opens.
const crypto = require('node:crypto');
const express = require('express');
const { TOKEN_PATTERN, familyView, hashToken } = require('../family-links');
const { parseMarkerId } = require('../validation');
const { siteOrigin } = require('../seo');

/** The owner's family link of a trip: whether it is on, a new link (shown once), or ending it. */
function createFamilyLinkRouter({ links, config }) {
    const router = express.Router({ mergeParams: true });
    const tripId = req => parseMarkerId(req.params.id);
    const notFound = res => res.status(404).json({ error: 'Trip not found.' });
    router.get('/', async (req, res) => {
        const id = tripId(req);
        const link = id && await links.find(req.user.id, id);
        if (!link?.owned) return notFound(res);
        return res.json({ active: Boolean(link.createdAt), createdAt: link.createdAt });
    });
    router.post('/', async (req, res) => {
        const id = tripId(req);
        const token = crypto.randomBytes(32).toString('base64url');
        const created = id && await links.replace(req.user.id, id, hashToken(token));
        if (!created) return notFound(res);
        return res.status(201).json({ url: `${siteOrigin(config, req)}/family/${token}`, createdAt: created.createdAt });
    });
    router.delete('/', async (req, res) => {
        const id = tripId(req);
        if (!id || !(await links.remove(req.user.id, id))) return notFound(res);
        return res.status(204).end();
    });
    return router;
}

/** The trip behind a family link, for whoever holds it. */
function createFamilyViewRouter({ links }) {
    const router = express.Router();
    router.get('/:token', async (req, res) => {
        const trip = TOKEN_PATTERN.test(req.params.token) ? await links.tripFor(hashToken(req.params.token)) : null;
        if (!trip) return res.status(404).json({ error: 'This link is not valid any more.' });
        res.set('X-Robots-Tag', 'noindex');
        return res.json(await familyView(trip));
    });
    return router;
}

module.exports = { createFamilyLinkRouter, createFamilyViewRouter };
