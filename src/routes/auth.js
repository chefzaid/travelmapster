'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { Passport } = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const { parseCredentials, parsePasswordChange, readPassword } = require('../validation');
const { getOrCreateToken } = require('../middleware/csrf');

const BCRYPT_ROUNDS = 12;

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        profileVisibility: user.profile_visibility || 'private'
    };
}

/** Each app gets its own Passport instance so strategies never leak between apps. */
function createPassport(users) {
    const passport = new Passport();
    // Compared against when the username is unknown, so response timing does
    // not reveal which usernames exist.
    const dummyHash = bcrypt.hashSync('travelmapster-timing-equalizer', BCRYPT_ROUNDS);

    passport.use(new LocalStrategy(async (username, password, done) => {
        try {
            const user = await users.findByUsername(String(username).trim());
            const matches = await bcrypt.compare(String(password), user ? user.password_hash : dummyHash);
            return done(null, user && matches ? user : false);
        } catch (err) {
            return done(err);
        }
    }));

    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser(async (id, done) => {
        try {
            // A deleted account yields false, which logs the stale session out.
            done(null, (await users.findById(id)) || false);
        } catch (err) {
            done(err);
        }
    });
    return passport;
}

function logout(req) {
    // passport 0.7 regenerates the session on logout as well.
    return new Promise((resolve, reject) => {
        req.logout(err => (err ? reject(err) : resolve()));
    });
}

function login(req, user) {
    // passport 0.7 regenerates the session on login, preventing fixation.
    return new Promise((resolve, reject) => {
        req.login(user, err => (err ? reject(err) : resolve()));
    });
}

function createAuthRouter({ passport, users, authLimiter, metrics, logger }) {
    const router = express.Router();

    router.post('/register', authLimiter, async (req, res) => {
        const { credentials, error } = parseCredentials(req.body);
        if (error) return res.status(400).json({ error });

        const passwordHash = await bcrypt.hash(credentials.password, BCRYPT_ROUNDS);
        const user = await users.create(credentials.username, passwordHash);
        if (!user) {
            metrics.authEvents.inc({ event: 'register', outcome: 'conflict' });
            return res.status(409).json({ error: 'Username already exists.' });
        }

        await login(req, user);
        metrics.authEvents.inc({ event: 'register', outcome: 'success' });
        logger.info({ userId: user.id }, 'User registered');
        return res.status(201).json({ user: publicUser(user), csrfToken: getOrCreateToken(req) });
    });

    router.post('/login', authLimiter, (req, res, next) => {
        passport.authenticate('local', async (err, user) => {
            if (err) return next(err);
            if (!user) {
                metrics.authEvents.inc({ event: 'login', outcome: 'failure' });
                return res.status(401).json({ error: 'Invalid username or password.' });
            }
            try {
                await login(req, user);
            } catch (loginErr) {
                return next(loginErr);
            }
            metrics.authEvents.inc({ event: 'login', outcome: 'success' });
            return res.json({ user: publicUser(user), csrfToken: getOrCreateToken(req) });
        })(req, res, next);
    });

    router.post('/logout', (req, res, next) => {
        req.logout(err => {
            if (err) return next(err);
            return res.json({ csrfToken: getOrCreateToken(req) });
        });
    });

    // Sensitive account changes re-check the password and share the login rate limit.
    async function passwordMatches(req, password) {
        const hash = await users.findPasswordHash(req.user.id);
        return Boolean(hash) && bcrypt.compare(password, hash);
    }

    router.post('/password', requireAuth, authLimiter, async (req, res) => {
        const { change, error } = parsePasswordChange(req.body);
        if (error) return res.status(400).json({ error });
        if (!(await passwordMatches(req, change.currentPassword))) {
            metrics.authEvents.inc({ event: 'password_change', outcome: 'failure' });
            return res.status(400).json({ error: 'Current password is incorrect.' });
        }

        await users.setPasswordHash(req.user.id, await bcrypt.hash(change.newPassword, BCRYPT_ROUNDS));
        // A fresh session here, and every other device signed out.
        await login(req, req.user);
        await users.endSessions(req.user.id, req.sessionID);
        metrics.authEvents.inc({ event: 'password_change', outcome: 'success' });
        logger.info({ userId: req.user.id }, 'Password changed');
        return res.json({ csrfToken: getOrCreateToken(req) });
    });

    router.delete('/account', requireAuth, authLimiter, async (req, res) => {
        const password = readPassword(req.body?.password);
        if (!password || !(await passwordMatches(req, password))) {
            metrics.authEvents.inc({ event: 'account_delete', outcome: 'failure' });
            return res.status(400).json({ error: 'Password is incorrect.' });
        }

        const userId = req.user.id;
        await users.remove(userId);
        await users.endSessions(userId);
        await logout(req);
        metrics.authEvents.inc({ event: 'account_delete', outcome: 'success' });
        logger.info({ userId }, 'Account deleted');
        return res.json({ csrfToken: getOrCreateToken(req) });
    });

    router.get('/me', (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
        return res.json({ user: publicUser(req.user) });
    });

    return router;
}

function requireAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    return res.status(401).json({ error: 'Not logged in.' });
}

module.exports = { createAuthRouter, createPassport, requireAuth, publicUser };
