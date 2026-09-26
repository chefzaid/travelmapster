'use strict';

const express = require('express');
const { parseMarkerId, parseTripPayload } = require('../validation');

// The UI treats a missing start date as an empty string.
function toClientTrip(trip) {
    return { ...trip, startDate: trip.startDate || '' };
}

function createTripRouter({ trips }) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        res.json((await trips.listForUser(req.user.id)).map(toClientTrip));
    });

    router.post('/', async (req, res) => {
        const { trip, error } = parseTripPayload(req.body);
        if (error) return res.status(400).json({ error });
        return res.status(201).json(toClientTrip(await trips.create(req.user.id, trip)));
    });

    router.put('/:id', async (req, res) => {
        const tripId = parseMarkerId(req.params.id);
        if (!tripId) return res.status(400).json({ error: 'Invalid trip id.' });
        const { trip, error } = parseTripPayload(req.body);
        if (error) return res.status(400).json({ error });
        const updated = await trips.update(req.user.id, tripId, trip);
        if (!updated) return res.status(404).json({ error: 'Trip not found.' });
        return res.json(toClientTrip(updated));
    });

    router.delete('/:id', async (req, res) => {
        const tripId = parseMarkerId(req.params.id);
        if (!tripId) return res.status(400).json({ error: 'Invalid trip id.' });
        if (!(await trips.remove(req.user.id, tripId))) {
            return res.status(404).json({ error: 'Trip not found.' });
        }
        return res.status(204).end();
    });

    return router;
}

module.exports = { createTripRouter };
