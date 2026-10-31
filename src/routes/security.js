'use strict';

// Sign-in security (ADR 0027): passkeys to add, list, remove and sign in with, two-step sign-in
// with an authenticator app and recovery codes, and the devices signed in (src/sessions.js).
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const {
    generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse
} = require('@simplewebauthn/server');
const { readPassword, normalizeText } = require('../validation');
const { getOrCreateToken } = require('../middleware/csrf');
const { siteOrigin } = require('../seo');
const totp = require('../totp');
const { login, sessionKey } = require('../sessions');

const MAX_PASSKEYS = 10;
const CHALLENGE_MS = 5 * 60_000;
const NAME_MAX_LENGTH = 60;

// Where passkeys belong: the public site's host, or the host the request came to.
function relyingParty(config, req) {
    const origin = siteOrigin(config, req);
    return { origin, rpID: new URL(origin).hostname };
}

// A WebAuthn challenge waits in the session for one use, of one kind, for five minutes.
function keepChallenge(req, kind, challenge) {
    req.session.webauthn = { kind, challenge, expires: Date.now() + CHALLENGE_MS };
}

function takeChallenge(req, kind) {
    const pending = req.session.webauthn;
    delete req.session.webauthn;
    return pending?.kind === kind && pending.expires > Date.now() ? pending.challenge : null;
}

// An opaque, stable WebAuthn user handle, so authenticators never see the account's number.
const userHandle = (config, user) => crypto.createHmac('sha256', config.totpKey).update(`webauthn:${user.id}`).digest().subarray(0, 16);

function createSecurityRouter({ config, users, security, sessions, authLimiter, requireAuth, publicUser, metrics, logger }) {
    const router = express.Router();
    const box = totp.createSecretBox(config.totpKey);

    async function passwordMatches(req, password) {
        const hash = await users.findPasswordHash(req.user.id);
        return Boolean(hash) && Boolean(password) && bcrypt.compare(password, hash);
    }

    router.get('/', requireAuth, async (req, res) => {
        const [passkeys, secret, left, devices] = await Promise.all([
            security.listPasskeys(req.user.id), security.findTotp(req.user.id), security.recoveryCodesLeft(req.user.id),
            sessions.list(req.user.id, req.sessionID)
        ]);
        res.json({ passkeys, twoStep: { enabled: Boolean(secret?.enabled), recoveryCodesLeft: secret?.enabled ? left : 0 }, sessions: devices });
    });

    // ---- devices signed in

    // Signs one other device out; this one signs out from the account menu.
    router.delete('/sessions/:id', requireAuth, async (req, res) => {
        const key = normalizeText(req.params.id);
        if (!/^[0-9a-f]{24}$/.test(key)) return res.status(400).json({ error: 'Invalid session id.' });
        if (key === sessionKey(req.sessionID)) return res.status(400).json({ error: 'To sign out of this device, use Log out in the account menu.' });
        if (!(await sessions.end(req.user.id, key))) return res.status(404).json({ error: 'Session not found.' });
        return res.status(204).end();
    });

    router.delete('/sessions', requireAuth, async (req, res) => {
        await users.endSessions(req.user.id, req.sessionID);
        return res.status(204).end();
    });

    // ---- passkeys of the signed-in traveler

    router.post('/passkeys/options', requireAuth, authLimiter, async (req, res) => {
        const existing = await security.listPasskeys(req.user.id);
        if (existing.length >= MAX_PASSKEYS) return res.status(409).json({ error: `An account holds at most ${MAX_PASSKEYS} passkeys.` });
        const { rpID } = relyingParty(config, req);
        const options = await generateRegistrationOptions({
            rpName: 'TravelMapster', rpID, userName: req.user.username, userID: userHandle(config, req.user),
            attestationType: 'none',
            excludeCredentials: existing.map(passkey => ({ id: passkey.id, transports: passkey.transports })),
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
        });
        keepChallenge(req, 'register', options.challenge);
        res.json(options);
    });

    router.post('/passkeys', requireAuth, authLimiter, async (req, res) => {
        const name = normalizeText(req.body?.name) || 'Passkey';
        if (name.length > NAME_MAX_LENGTH) return res.status(400).json({ error: `Name the passkey in ${NAME_MAX_LENGTH} characters or fewer.` });
        const challenge = takeChallenge(req, 'register');
        if (!challenge) return res.status(400).json({ error: 'The passkey request expired. Please try again.' });
        const { origin, rpID } = relyingParty(config, req);
        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response: req.body?.response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
                requireUserVerification: true
            });
        } catch (err) {
            logger.info({ err: err.message }, 'Passkey registration refused');
            return res.status(400).json({ error: 'The passkey could not be checked. Please try again.' });
        }
        if (!verification.verified) return res.status(400).json({ error: 'The passkey could not be checked. Please try again.' });
        const { credential } = verification.registrationInfo;
        if (await security.findPasskey(credential.id)) return res.status(409).json({ error: 'This passkey is already registered.' });
        const passkey = await security.addPasskey(req.user.id, {
            id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports || [], name
        });
        metrics.authEvents.inc({ event: 'passkey_add', outcome: 'success' });
        logger.info({ userId: req.user.id }, 'Passkey added');
        return res.status(201).json(passkey);
    });

    router.delete('/passkeys/:id', requireAuth, async (req, res) => {
        if (!(await security.removePasskey(req.user.id, String(req.params.id)))) return res.status(404).json({ error: 'Passkey not found.' });
        logger.info({ userId: req.user.id }, 'Passkey removed');
        return res.status(204).end();
    });

    // ---- signing in with a passkey, without a username or password

    router.post('/passkey-login/options', authLimiter, async (req, res) => {
        const { rpID } = relyingParty(config, req);
        const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
        keepChallenge(req, 'login', options.challenge);
        res.json(options);
    });

    router.post('/passkey-login', authLimiter, async (req, res, next) => {
        const refused = () => {
            metrics.authEvents.inc({ event: 'passkey_login', outcome: 'failure' });
            return res.status(401).json({ error: 'That passkey could not sign you in.' });
        };
        const challenge = takeChallenge(req, 'login');
        const response = req.body?.response;
        if (!challenge || typeof response?.id !== 'string') return refused();
        const passkey = await security.findPasskey(response.id);
        if (!passkey) return refused();
        const { origin, rpID } = relyingParty(config, req);
        let verification;
        try {
            verification = await verifyAuthenticationResponse({
                response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
                credential: { id: passkey.id, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: passkey.transports }
            });
        } catch (err) {
            logger.info({ err: err.message }, 'Passkey sign-in refused');
            return refused();
        }
        if (!verification.verified) return refused();
        await security.usePasskey(passkey.id, verification.authenticationInfo.newCounter);
        const user = await users.findById(passkey.userId);
        if (!user) return refused();
        try {
            await login(req, user);
        } catch (err) {
            return next(err);
        }
        metrics.authEvents.inc({ event: 'passkey_login', outcome: 'success' });
        return res.json({ user: publicUser(user), csrfToken: getOrCreateToken(req) });
    });

    // ---- two-step sign-in

    router.post('/two-step/setup', requireAuth, authLimiter, async (req, res) => {
        const secret = totp.generateSecret();
        if (!(await security.startTotp(req.user.id, box.seal(secret)))) {
            return res.status(409).json({ error: 'Two-step sign-in is already on.' });
        }
        return res.json({ secret: totp.base32Encode(secret), uri: totp.otpauthUri(secret, req.user.username) });
    });

    router.post('/two-step/enable', requireAuth, authLimiter, async (req, res) => {
        const stored = await security.findTotp(req.user.id);
        if (!stored) return res.status(400).json({ error: 'Start setting up two-step sign-in first.' });
        if (stored.enabled) return res.status(409).json({ error: 'Two-step sign-in is already on.' });
        const secret = box.open(stored.secret);
        const step = secret && totp.verifyTotp(secret, req.body?.code);
        if (step === null || !secret) return res.status(400).json({ error: 'That code does not match. Check the time on your phone and try the newest code.' });
        const codes = totp.generateRecoveryCodes();
        await security.enableTotp(req.user.id, step, codes.map(totp.hashRecoveryCode));
        metrics.authEvents.inc({ event: 'two_step_on', outcome: 'success' });
        logger.info({ userId: req.user.id }, 'Two-step sign-in turned on');
        return res.json({ recoveryCodes: codes });
    });

    router.post('/two-step/disable', requireAuth, authLimiter, async (req, res) => {
        if (!(await passwordMatches(req, readPassword(req.body?.password)))) return res.status(400).json({ error: 'Password is incorrect.' });
        await security.disableTotp(req.user.id);
        logger.info({ userId: req.user.id }, 'Two-step sign-in turned off');
        return res.status(204).end();
    });

    return router;
}

/**
 * The second step of a password sign-in: a code from the authenticator app or a recovery code,
 * within five minutes and five tries of the password. Resolves to the user, or to an error.
 */
async function checkSecondStep(req, { config, users, security }) {
    const pending = req.session.secondStep;
    if (!pending || pending.expires < Date.now() || pending.tries >= 5) {
        delete req.session.secondStep;
        return { status: 401, error: 'Please sign in again: the code was not entered in time.' };
    }
    pending.tries += 1;
    const { code, recoveryCode } = req.body || {};
    let passed;
    if (recoveryCode) {
        passed = await security.useRecoveryCode(pending.userId, totp.hashRecoveryCode(recoveryCode));
    } else {
        const stored = await security.findTotp(pending.userId);
        const secret = stored?.enabled ? totp.createSecretBox(config.totpKey).open(stored.secret) : null;
        const step = secret ? totp.verifyTotp(secret, code, { lastStep: stored.lastStep }) : null;
        passed = step !== null && await security.useTotpStep(pending.userId, step);
    }
    if (!passed) return { status: 400, error: recoveryCode ? 'That recovery code is not right, or was used already.' : 'That code is not right. Try the newest one.' };
    delete req.session.secondStep;
    const user = await users.findById(pending.userId);
    return user ? { user } : { status: 401, error: 'Please sign in again.' };
}

/** Whether a password sign-in must wait for a second step; if so, the session remembers it. */
async function needsSecondStep(req, user, security) {
    const stored = await security.findTotp(user.id);
    if (!stored?.enabled) return false;
    req.session.secondStep = { userId: user.id, expires: Date.now() + CHALLENGE_MS, tries: 0 };
    return true;
}

module.exports = { checkSecondStep, createSecurityRouter, needsSecondStep };
