'use strict';

const express = require('express');
const { normalizeText } = require('../validation');

function createPlacesRouter({ places }) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const query = normalizeText(req.query.q);
        const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20);
        if (query.length < 2 || query.length > 100) {
            return res.status(400).json({ error: 'Query must be 2 to 100 characters.' });
        }
        res.set('Cache-Control', 'public, max-age=3600');
        return res.json(await places.search(query, limit));
    });

    return router;
}

module.exports = { createPlacesRouter };
