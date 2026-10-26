'use strict';

const express = require('express');
const { parseLedgerSettings } = require('../validation');

// Enough for years of edits; the evidence report reads the history of the visits it lists.
const CHANGES_LIMIT = 5000;

/** Day-ledger settings and the history of visit dates; the counting itself runs in the browser. */
function createLedgerRouter({ ledger, metrics }) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        res.json(await ledger.findSettings(req.user.id));
    });

    router.put('/', async (req, res) => {
        const { settings, error } = parseLedgerSettings(req.body);
        if (error) return res.status(400).json({ error });
        const { settings: saved, firstSave } = await ledger.saveSettings(req.user.id, settings);
        if (firstSave) metrics.funnel.inc({ step: 'first_ledger_use' });
        return res.json(saved);
    });

    router.get('/changes', async (req, res) => {
        res.json(await ledger.listChanges(req.user.id, CHANGES_LIMIT));
    });

    return router;
}

module.exports = { createLedgerRouter };
