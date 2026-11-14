'use strict';

// The signed-in traveler's API tokens (src/api-tokens.js): listed, made (shown once) and
// revoked, each change in the security activity. Tokens themselves never reach these routes.
const express = require('express');
const { hashToken, newToken, parseTokenName } = require('../api-tokens');
const { parseMarkerId } = require('../validation');
const { recordChange } = require('../sessions');

function createApiTokenRouter({ tokens, security }) {
    const router = express.Router();
    router.get('/', async (req, res) => res.json(await tokens.list(req.user.id)));
    router.post('/', async (req, res) => {
        const { name, error } = parseTokenName(req.body);
        if (error) return res.status(400).json({ error });
        const token = newToken();
        const created = await tokens.create(req.user.id, name, hashToken(token));
        if (!created) return res.status(409).json({ error: 'You can keep up to 10 API tokens. Revoke one first.' });
        await recordChange(security, req, 'api_token_created');
        return res.status(201).json({ ...created, token });
    });
    router.delete('/:id', async (req, res) => {
        const id = parseMarkerId(req.params.id);
        if (!id || !(await tokens.revoke(req.user.id, id))) return res.status(404).json({ error: 'API token not found.' });
        await recordChange(security, req, 'api_token_revoked');
        return res.status(204).end();
    });
    return router;
}

module.exports = { createApiTokenRouter };
