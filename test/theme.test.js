'use strict';

// Light or dark (public/js/theme.js): the stylesheets' dark blocks follow the system, or are
// turned on or off by the choice.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'theme.js'));

test('a choice turns the dark blocks on or off, and "system" gives them back to the system', async () => {
    const { applyTheme, storedTheme } = await load();
    assert.equal(storedTheme(), 'system', 'without storage the system decides');
    const dark = { media: { mediaText: '(prefers-color-scheme: dark)' } };
    const print = { media: { mediaText: 'print' } };
    const plain = { selectorText: 'body' };
    const root = {
        documentElement: { dataset: {} },
        styleSheets: [
            { cssRules: [plain, dark, print] },
            { get cssRules() { throw new Error('another origin'); } }
        ]
    };
    applyTheme('dark', root);
    assert.equal(dark.media.mediaText, 'all');
    assert.equal(print.media.mediaText, 'print', 'other media rules are left alone');
    assert.equal(root.documentElement.dataset.theme, 'dark');
    applyTheme('light', root);
    assert.equal(dark.media.mediaText, 'not all');
    applyTheme('neon', root);
    assert.equal(dark.media.mediaText, '(prefers-color-scheme: dark)');
    assert.equal(root.documentElement.dataset.theme, 'system');
});
