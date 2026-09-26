'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { csrfProtection, getOrCreateToken } = require('../../src/middleware/csrf');

function run(method, sessionToken, headerToken) {
    let status = null;
    let passed = false;
    const req = { method, session: { csrfToken: sessionToken }, get: () => headerToken };
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    csrfProtection(req, res, () => { passed = true; });
    return { passed, status };
}

test('safe methods pass without a token', () => {
    assert.equal(run('GET').passed, true);
    assert.equal(run('HEAD').passed, true);
});

test('unsafe methods need the matching session token', () => {
    assert.equal(run('POST', 'abc', 'abc').passed, true);
    assert.equal(run('POST', 'abc', 'abd').status, 403);
    assert.equal(run('DELETE', 'abc', undefined).status, 403);
    assert.equal(run('PATCH', undefined, undefined).status, 403);
    assert.equal(run('POST', 'abc', 'abcd').status, 403);
});

test('tokens are random and stable within a session', () => {
    const session = {};
    const first = getOrCreateToken({ session });
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(getOrCreateToken({ session }), first);
    assert.notEqual(getOrCreateToken({ session: {} }), first);
});
