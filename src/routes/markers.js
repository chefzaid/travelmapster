'use strict';

const express = require('express');
const { withTransaction } = require('../db/pool');
const { IMPORT_MAX_MARKERS, parseMarkerId, parseMarkerPayload } = require('../validation');

function createMarkerRouter({ pool, markers }) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(await markers.listForUser(req.user.id));
    });

    router.post('/', async (req, res) => {
        const { marker, error } = parseMarkerPayload(req.body);
        if (error) return res.status(400).json({ error });
        return res.status(201).json(await markers.create(req.user.id, marker));
    });

    router.post('/import', async (req, res) => {
        const records = req.body?.markers;
        if (!Array.isArray(records)) {
            return res.status(400).json({ error: 'Request body must contain a "markers" array.' });
        }
        if (records.length > IMPORT_MAX_MARKERS) {
            return res.status(413).json({ error: `Import at most ${IMPORT_MAX_MARKERS} places at a time.` });
        }

        const valid = [];
        const rejected = [];
        records.forEach((record, index) => {
            const { marker, error } = parseMarkerPayload(record);
            if (marker) valid.push(marker);
            else rejected.push({ index, error });
        });

        const created = await withTransaction(pool, async client => {
            const rows = [];
            for (const marker of valid) {
                rows.push(await markers.create(req.user.id, marker, client));
            }
            return rows;
        });

        return res.status(201).json({
            imported: created.length,
            skipped: rejected.length,
            errors: rejected.slice(0, 20),
            markers: created
        });
    });

    router.patch('/:id', async (req, res) => {
        const markerId = parseMarkerId(req.params.id);
        if (!markerId) return res.status(400).json({ error: 'Invalid marker id.' });
        const { marker, error } = parseMarkerPayload(req.body);
        if (error) return res.status(400).json({ error });

        const updated = await markers.update(req.user.id, markerId, marker);
        if (!updated) return res.status(404).json({ error: 'Marker not found.' });
        return res.json(updated);
    });

    router.delete('/:id', async (req, res) => {
        const markerId = parseMarkerId(req.params.id);
        if (!markerId) return res.status(400).json({ error: 'Invalid marker id.' });
        if (!(await markers.remove(req.user.id, markerId))) {
            return res.status(404).json({ error: 'Marker not found.' });
        }
        return res.status(204).end();
    });

    return router;
}

module.exports = { createMarkerRouter };
