'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDER = '/__assets__/';

/** Short hash over every file in the directory, so each release gets its own asset URLs. */
function fingerprint(directory) {
    const hash = crypto.createHash('sha256');
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else hash.update(path.relative(directory, file)).update(fs.readFileSync(file));
        }
    };
    walk(directory);
    return hash.digest('hex').slice(0, 12);
}

/**
 * The page links its scripts, styles and data under /a/<fingerprint>/. Those URLs can be
 * cached for a year, because a release changes the fingerprint; the page itself is never
 * cached, so browsers and the CDN always load one consistent set of files.
 */
function createAssets(publicDir) {
    const version = fingerprint(publicDir);
    const base = `/a/${version}/`;
    const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replaceAll(PLACEHOLDER, base);
    return { version, base, indexHtml, placeholder: PLACEHOLDER };
}

module.exports = { createAssets, fingerprint };
