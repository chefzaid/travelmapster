'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, DEV_SESSION_SECRET } = require('../../src/config');

test('development falls back to an insecure secret', () => {
    const config = loadConfig({});
    assert.equal(config.session.secret, DEV_SESSION_SECRET);
    assert.equal(config.session.secureCookie, false);
    assert.equal(config.port, 3000);
    assert.equal(config.trustProxy, false);
});

test('production requires a strong session secret', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' }), /SESSION_SECRET/);
    const config = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) });
    assert.equal(config.session.secureCookie, true);
});

test('trust proxy accepts booleans, hop counts and CIDR lists', () => {
    assert.equal(loadConfig({ TRUST_PROXY: 'true' }).trustProxy, true);
    assert.equal(loadConfig({ TRUST_PROXY: '2' }).trustProxy, 2);
    assert.deepEqual(loadConfig({ TRUST_PROXY: '10.42.0.0/16, 127.0.0.1' }).trustProxy, ['10.42.0.0/16', '127.0.0.1']);
});

test('invalid integers are rejected', () => {
    assert.throws(() => loadConfig({ PORT: 'eighty' }), /PORT/);
});
