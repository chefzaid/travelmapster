'use strict';

// Kilometers or miles (public/js/units.js): the regional default and distances written in each.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

test('miles where roads are signed in them, kilometers elsewhere', async () => {
    const { regionalUnit } = await load('units.js');
    assert.equal(regionalUnit(['en-US', 'en']), 'mi');
    assert.equal(regionalUnit(['en-GB']), 'mi');
    assert.equal(regionalUnit(['en-CA']), 'km');
    assert.equal(regionalUnit(['fr']), 'km');
    assert.equal(regionalUnit([]), 'km');
});

test('distances are written in the unit and the language\'s way', async () => {
    const { formatDistance } = await load('units.js');
    const { useCatalog } = await load('i18n.js');
    useCatalog('en');
    assert.equal(formatDistance(12_345, 'km'), '12,345 km');
    assert.equal(formatDistance(12_345, 'mi'), '7,671 mi');
    assert.equal(formatDistance(10, 'parsecs'), '10 km', 'an unknown unit falls back to kilometers');
    useCatalog('fr', {});
    assert.equal(formatDistance(12_345, 'km'), (12_345).toLocaleString('fr', { style: 'unit', unit: 'kilometer', unitDisplay: 'short' }), 'French spacing');
    useCatalog('en');
});
