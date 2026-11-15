'use strict';

// The signed-in traveler's flight log (src/flights.js): listed, added and removed.
const express = require('express');
const { parseFlight, parseFlights } = require('../flights');
const { parseMarkerId } = require('../validation');

function createFlightRouter({ flights }) {
    const router = express.Router();
    router.get('/', async (req, res) => res.json(await flights.list(req.user.id)));
    router.post('/', async (req, res) => {
        const { flight, error } = parseFlight(req.body);
        if (error) return res.status(400).json({ error });
        const added = await flights.add(req.user.id, flight);
        if (!added) return res.status(409).json({ error: 'A flight log holds at most 2,000 flights.' });
        return res.status(201).json(added);
    });
    // Many at once, such as pasted from an airline's or tracking app's export.
    router.post('/import', async (req, res) => {
        const { flights: given, error } = parseFlights(req.body);
        if (error) return res.status(400).json({ error });
        const added = await flights.addMany(req.user.id, given);
        return res.status(201).json({ flights: added, full: added.length < given.length });
    });
    router.delete('/:id', async (req, res) => {
        const id = parseMarkerId(req.params.id);
        if (!id || !(await flights.remove(req.user.id, id))) return res.status(404).json({ error: 'Flight not found.' });
        return res.status(204).end();
    });
    return router;
}

module.exports = { createFlightRouter };
