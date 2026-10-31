'use strict';

// Keyboard shortcuts (public/js/shortcuts.js): one key each, waiting while the traveler types.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'shortcuts.js'));

test('each shortcut has its own key and a description', async () => {
    const { SHORTCUTS } = await load();
    const keys = SHORTCUTS.map(([key]) => key.toLowerCase());
    assert.equal(new Set(keys).size, keys.length);
    for (const [key, label] of SHORTCUTS) assert.ok(key && label, key);
});

test('shortcuts wait while the traveler types in a field', async () => {
    const { isTyping } = await load();
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isTyping({ tagName }), true, tagName);
    assert.equal(isTyping({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isTyping({ tagName: 'BUTTON' }), false);
    assert.equal(isTyping(null), false);
});
