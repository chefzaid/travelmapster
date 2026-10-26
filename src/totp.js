'use strict';

// Two-step sign-in codes (ADR 0027): time-based one-time passwords (RFC 6238, HMAC-SHA1, six
// digits, 30 seconds), their secrets encrypted at rest, and single-use recovery codes.
const crypto = require('node:crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const RECOVERY_CODES = 10;

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
    return output;
}

function base32Decode(text) {
    const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const character of clean) {
        const index = BASE32.indexOf(character);
        if (index < 0) throw new Error('Not base32.');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

/** A new secret of 20 random bytes, as RFC 4226 recommends. */
function generateSecret() {
    return crypto.randomBytes(20);
}

/** The HOTP code for a counter (RFC 4226). */
function hotp(secret, counter, digits = DIGITS) {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac('sha1', secret).update(message).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = digest.readUInt32BE(offset) & 0x7fffffff;
    return String(binary % 10 ** digits).padStart(digits, '0');
}

const stepAt = now => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * The time step a six-digit code matches, one step either side of now and later than
 * `lastStep` (each step is accepted once); null when it matches none.
 */
function verifyTotp(secret, code, { now = Date.now(), lastStep = null } = {}) {
    const clean = String(code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return null;
    const current = stepAt(now);
    for (const step of [current - 1, current, current + 1]) {
        if (lastStep !== null && step <= lastStep) continue;
        if (crypto.timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(clean))) return step;
    }
    return null;
}

/** The URI an authenticator app reads from the QR code. */
function otpauthUri(secret, account, issuer = 'TravelMapster') {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const query = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
    return `otpauth://totp/${label}?${query}`;
}

/** AES-256-GCM under a key derived from `keyMaterial`; ciphertexts are "iv.tag.data" in base64url. */
function createSecretBox(keyMaterial) {
    const key = Buffer.from(crypto.hkdfSync('sha256', String(keyMaterial), 'travelmapster', 'totp secrets v1', 32));
    return {
        seal(plain) {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const data = Buffer.concat([cipher.update(plain), cipher.final()]);
            return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
        },
        /** The plain bytes, or null when the box was sealed under another key or tampered with. */
        open(sealed) {
            try {
                const [iv, tag, data] = String(sealed).split('.').map(part => Buffer.from(part, 'base64url'));
                const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                decipher.setAuthTag(tag);
                return Buffer.concat([decipher.update(data), decipher.final()]);
            } catch {
                return null;
            }
        }
    };
}

const normalizeRecoveryCode = code => String(code ?? '').toLowerCase().replace(/[^a-z2-7]/g, '');

/** A SHA-256 hash of a recovery code, ignoring case, spaces and dashes. */
function hashRecoveryCode(code) {
    return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/** Ten recovery codes such as "k7ra-2mzq-p4tx", about 60 bits each. */
function generateRecoveryCodes(count = RECOVERY_CODES) {
    return Array.from({ length: count }, () => {
        const text = base32Encode(crypto.randomBytes(8)).slice(0, 12).toLowerCase();
        return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}`;
    });
}

module.exports = {
    base32Decode, base32Encode, createSecretBox, generateRecoveryCodes, generateSecret, hashRecoveryCode, hotp,
    normalizeRecoveryCode, otpauthUri, verifyTotp
};
