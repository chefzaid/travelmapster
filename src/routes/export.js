'use strict';

const express = require('express');
const { publicUser } = require('./auth');

// Bumped when the shape of the archive changes, so a future import can read older ones.
const EXPORT_VERSION = 1;

/**
 * Everything the account holds, in one JSON document: the profile and settings, places with
 * their visits, trips, ledger settings and the whole history of visit dates. The browser packs
 * it into the downloadable archive (ADR 0017: a record you can keep).
 */
function createExportRouter({ markers, trips, ledger, security, follows, metrics }) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const userId = req.user.id;
        const [places, itineraries, settings, changes, passkeys, secret, followed] = await Promise.all([
            markers.listForUser(userId),
            // The traveler's own trips, never those others share with them (ADR 0028).
            trips.listOwned(userId),
            ledger.findSettings(userId),
            ledger.listChanges(userId, null),
            security.listPasskeys(userId),
            security.findTotp(userId),
            follows.list(userId)
        ]);
        metrics.exports.inc();
        res.json({
            format: 'travelmapster-account',
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            profile: { ...publicUser(req.user), lastActiveDay: req.user.last_seen_on ?? null },
            places,
            trips: itineraries,
            ledger: { settings, changes },
            follows: followed.map(({ username, since }) => ({ username, since })),
            // How the account signs in, never the keys or secrets themselves (ADR 0027).
            security: {
                passkeys: passkeys.map(({ name, createdAt, lastUsedAt }) => ({ name, createdAt, lastUsedAt })),
                twoStep: Boolean(secret?.enabled)
            }
        });
    });

    return router;
}

module.exports = { createExportRouter, EXPORT_VERSION };
