'use strict';

const express = require('express');
const { withTransaction } = require('../db/pool');
const { IMPORT_MAX_MARKERS, parseBulkChanges, parseMarkerId, parseMarkerPayload, parseVisitPayload } = require('../validation');
const { checkVisitPurpose } = require('./orgs');

// Funnel steps reached when a traveler's number of places first crosses them.
/** @type {Array<[number, string]>} */
const PLACE_STEPS = [[1, 'first_place'], [10, 'ten_places']];

function createMarkerRouter({ pool, markers, visits, metrics, orgs }) {
    const router = express.Router();

    // Counts places saved by a route, and the funnel steps a traveler crossed with them.
    async function countPlaces(userId, source, created, removed = 0) {
        if (created) metrics.placesSaved.inc({ source }, created);
        const added = created - removed;
        if (added <= 0) return;
        const after = await markers.count(userId);
        for (const [threshold, step] of PLACE_STEPS) {
            if (after - added < threshold && after >= threshold) metrics.funnel.inc({ step });
        }
    }

    router.get('/', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(await markers.listForUser(req.user.id));
    });

    router.post('/', async (req, res) => {
        const { marker, error } = parseMarkerPayload(req.body, { withVisits: true });
        if (error) return res.status(400).json({ error });
        const created = await withTransaction(pool, client => markers.create(req.user.id, marker, client));
        await countPlaces(req.user.id, 'single', 1);
        return res.status(201).json(created);
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
            const { marker, error } = parseMarkerPayload(record, { withVisits: true });
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
        await countPlaces(req.user.id, 'import', created.length);

        return res.status(201).json({
            imported: created.length,
            skipped: rejected.length,
            errors: rejected.slice(0, 20),
            markers: created
        });
    });

    // Several places marked, changed or removed in one transaction, such as a whole continent
    // marked at once and its undo.
    router.post('/bulk', async (req, res) => {
        const { changes, error } = parseBulkChanges(req.body);
        if (error) return res.status(400).json({ error });
        try {
            const result = await withTransaction(pool, client => markers.applyBulk(req.user.id, changes, client));
            await countPlaces(req.user.id, 'bulk', result.created.length, result.removed.length);
            return res.json(result);
        } catch (err) {
            if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
            throw err;
        }
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

    // Two pins for the same place: this one takes the other's visits and missing details.
    router.post('/:id/merge', async (req, res) => {
        const keepId = parseMarkerId(req.params.id);
        const otherId = parseMarkerId(req.body?.from);
        if (!keepId || !otherId) return res.status(400).json({ error: 'Invalid marker id.' });
        if (keepId === otherId) return res.status(400).json({ error: 'Choose two different places to merge.' });
        const merged = await withTransaction(pool, client => markers.merge(req.user.id, keepId, otherId, client));
        if (!merged) return res.status(404).json({ error: 'Marker not found.' });
        return res.json(merged);
    });

    router.delete('/:id', async (req, res) => {
        const markerId = parseMarkerId(req.params.id);
        if (!markerId) return res.status(400).json({ error: 'Invalid marker id.' });
        if (!(await markers.remove(req.user.id, markerId))) {
            return res.status(404).json({ error: 'Marker not found.' });
        }
        return res.status(204).end();
    });

    router.get('/:id/visits', async (req, res) => {
        const markerId = parseMarkerId(req.params.id);
        if (!markerId) return res.status(400).json({ error: 'Invalid marker id.' });
        const list = await visits.listForMarker(req.user.id, markerId);
        if (!list) return res.status(404).json({ error: 'Marker not found.' });
        return res.json(list);
    });

    router.post('/:id/visits', async (req, res) => {
        const markerId = parseMarkerId(req.params.id);
        if (!markerId) return res.status(400).json({ error: 'Invalid marker id.' });
        const { visit, error } = parseVisitPayload(req.body);
        if (error) return res.status(400).json({ error });
        const refused = await checkVisitPurpose(orgs, req.user.id, visit);
        if (refused) return res.status(400).json({ error: refused });
        const created = await visits.create(req.user.id, markerId, visit);
        if (!created) return res.status(404).json({ error: 'Marker not found.' });
        return res.status(201).json(created);
    });

    return router;
}

module.exports = { createMarkerRouter };
