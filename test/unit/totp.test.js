'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../../src/totp');

// RFC 6238 appendix B: the SHA-1 secret is the ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890');

test('codes match the RFC 4226 and RFC 6238 test vectors', () => {
    const hotpVectors = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    hotpVectors.forEach((code, counter) => assert.equal(totp.hotp(RFC_SECRET, counter), code));
    for (const [seconds, code] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']]) {
        assert.equal(totp.hotp(RFC_SECRET, Math.floor(seconds / 30), 8), code);
    }
});

test('a code is accepted one step either side of now, and each step once', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = totp.hotp(RFC_SECRET, step);
    assert.equal(totp.verifyTotp(RFC_SECRET, code, { now }), step);
    assert.equal(totp.verifyTotp(RFC_SECRET, ` ${code.slice(0, 3)} ${code.slice(3)} `, { now }), step, 'spaces are ignored');
    assert.equal(totp.verifyTotp(RFC_SECRET, totp.hotp(RFC_SECRET, step - 1), { now }), step - 1);
    assert.equal(totp.verifyTotp(RFC_SECRET, totp.hotp(RFC_SECRET, step + 1), { now }), step + 1);
    assert.equal(totp.verifyTotp(RFC_SECRET, totp.hotp(RFC_SECRET, step - 2), { now }), null);
    assert.equal(totp.verifyTotp(RFC_SECRET, code, { now, lastStep: step }), null, 'a used step is refused');
    for (const bad of ['', '12345', '1234567', 'abcdef', null]) assert.equal(totp.verifyTotp(RFC_SECRET, bad, { now }), null);
});

test('secrets round-trip through base32, an otpauth URI and the sealed box', () => {
    const secret = totp.generateSecret();
    assert.equal(secret.length, 20);
    assert.deepEqual(totp.base32Decode(totp.base32Encode(secret)), secret);
    assert.equal(totp.base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
    assert.deepEqual(totp.base32Decode('mzxw-6ytb oi=='), Buffer.from('foobar'));
    assert.throws(() => totp.base32Decode('1'), /Not base32/);
    const uri = new URL(totp.otpauthUri(secret, 'zaid'));
    assert.equal(uri.protocol, 'otpauth:');
    assert.equal(uri.host, 'totp');
    assert.equal(decodeURIComponent(uri.pathname), '/TravelMapster:zaid');
    assert.equal(uri.searchParams.get('secret'), totp.base32Encode(secret));
    assert.equal(uri.searchParams.get('issuer'), 'TravelMapster');

    const box = totp.createSecretBox('a key that is long enough for the test');
    const sealed = box.seal(secret);
    assert.notEqual(sealed, box.seal(secret), 'a fresh IV each time');
    assert.deepEqual(box.open(sealed), secret);
    assert.equal(totp.createSecretBox('another key').open(sealed), null);
    assert.equal(box.open(`${sealed.slice(0, -2)}xx`), null, 'tampering is caught');
    assert.equal(box.open('garbage'), null);
});

test('recovery codes are random, readable and hashed loosely', () => {
    const codes = totp.generateRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    assert.ok(codes.every(code => /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/.test(code)));
    assert.equal(totp.hashRecoveryCode(codes[0]), totp.hashRecoveryCode(` ${codes[0].toUpperCase().replace(/-/g, ' ')} `));
    assert.notEqual(totp.hashRecoveryCode(codes[0]), totp.hashRecoveryCode(codes[1]));
    assert.equal(totp.normalizeRecoveryCode(undefined), '');
});
