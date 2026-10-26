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

// The HTML pages, by the file in public/ that holds them.
const PAGES = ['index.html', 'schengen-calculator.html', 'embed.html'];

/**
 * The pages link their scripts, styles and data under /a/<fingerprint>/. Those URLs can be
 * cached for a year, because a release changes the fingerprint; the pages themselves are
 * never cached, so browsers and the CDN always load one consistent set of files.
 */
function createAssets(publicDir) {
    const version = fingerprint(publicDir);
    const base = `/a/${version}/`;
    const pages = Object.fromEntries(PAGES.map(file =>
        [file, fs.readFileSync(path.join(publicDir, file), 'utf8').replaceAll(PLACEHOLDER, base)]));
    return { version, base, pages, placeholder: PLACEHOLDER };
}

module.exports = { createAssets, fingerprint };
