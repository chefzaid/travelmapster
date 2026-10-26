'use strict';

const express = require('express');
const { parseMarkerId, parseVisitPayload } = require('../validation');
const { checkVisitPurpose } = require('./orgs');

/** Edits and removes single visits; listing and adding live under /api/markers/:id/visits. */
function createVisitRouter({ visits, orgs }) {
    const router = express.Router();

    router.patch('/:id', async (req, res) => {
        const visitId = parseMarkerId(req.params.id);
        if (!visitId) return res.status(400).json({ error: 'Invalid visit id.' });
        const { visit, error } = parseVisitPayload(req.body);
        if (error) return res.status(400).json({ error });
        const refused = await checkVisitPurpose(orgs, req.user.id, visit);
        if (refused) return res.status(400).json({ error: refused });
        const updated = await visits.update(req.user.id, visitId, visit);
        if (!updated) return res.status(404).json({ error: 'Visit not found.' });
        return res.json(updated);
    });

    router.delete('/:id', async (req, res) => {
        const visitId = parseMarkerId(req.params.id);
        if (!visitId) return res.status(400).json({ error: 'Invalid visit id.' });
        if (!(await visits.remove(req.user.id, visitId))) {
            return res.status(404).json({ error: 'Visit not found.' });
        }
        return res.status(204).end();
    });

    return router;
}

module.exports = { createVisitRouter };
