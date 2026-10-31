'use strict';

// Signed-in devices (src/sessions.js): the browser and system a User-Agent names, and session keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeDevice, sessionKey } = require('../../src/sessions');

test('a User-Agent names the browser and system, and nothing else is kept', () => {
    const cases = [
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari', 'iOS'],
        ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1', 'Chrome', 'iPadOS'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0', 'Edge', 'Windows'],
        ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox', 'Linux'],
        ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Chrome', 'ChromeOS'],
        ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36', 'Samsung Internet', 'Android'],
        ['curl/8.5.0', null, null],
        [undefined, null, null]
    ];
    for (const [userAgent, browser, os] of cases) assert.deepEqual(describeDevice(userAgent), { browser, os }, userAgent);
});

test('a session is named by a hash, the same each time and never its id', () => {
    assert.match(sessionKey('abc'), /^[0-9a-f]{24}$/);
    assert.equal(sessionKey('abc'), sessionKey('abc'));
    assert.notEqual(sessionKey('abc'), sessionKey('abd'));
    assert.ok(!sessionKey('abc').includes('abc'));
});
