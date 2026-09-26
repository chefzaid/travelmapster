'use strict';

const express = require('express');
const { normalizeText } = require('../validation');

const KINDS = new Set(['city', 'country']);

function createGeocodeRouter({ geocoder, logger }) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const query = normalizeText(req.query.q);
        const kind = normalizeText(req.query.kind) || 'city';
        const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);

        if (query.length < 2 || query.length > 200) {
            return res.status(400).json({ error: 'Query must be 2 to 200 characters.' });
        }
        if (!KINDS.has(kind)) {
            return res.status(400).json({ error: 'Kind must be city or country.' });
        }

        try {
            const places = await geocoder.search(query, kind, limit);
            res.set('Cache-Control', 'private, max-age=3600');
            return res.json(places);
        } catch (err) {
            logger.warn({ err, kind }, 'Geocoder lookup failed');
            return res.status(502).json({ error: 'Place search is temporarily unavailable.' });
        }
    });

    return router;
}

module.exports = { createGeocodeRouter };
