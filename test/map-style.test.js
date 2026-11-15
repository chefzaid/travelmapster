'use strict';

// The map's style (public/js/map-style.js): every layer has its own id and a source that
// exists, paint and layout read the zoom only at the top of an expression as MapLibre
// requires, and the regions and journeys draw from sources that start empty.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'map-style.js'));
const colour = '#123456';
const theme = new Proxy({ land: Array(7).fill(colour), heat: Array(5).fill(colour) }, { get: (target, key) => target[key] ?? colour });

// Whether ['zoom'] appears anywhere but as the input of a top-level step or interpolate.
function nestedZoom(expression, top = true) {
    if (!Array.isArray(expression)) return false;
    if (expression[0] === 'zoom') return !top;
    const [operator, ...rest] = expression;
    if (top && (operator === 'step' || operator === 'interpolate')) {
        const inputAt = operator === 'step' ? 0 : 1;
        return rest.some((part, i) => (i === inputAt ? false : nestedZoom(part, false)));
    }
    return rest.some(part => nestedZoom(part, false));
}

test('the style is well formed: unique layers, known sources, zoom read at the top only', async () => {
    const { buildStyle, EMPTY, STATUS_LAYERS, toMapZoom, REGIONS_MIN_ZOOM } = await load();
    const style = buildStyle(theme, EMPTY, EMPTY);
    assert.equal(style.version, 8);
    const ids = style.layers.map(layer => layer.id);
    assert.equal(new Set(ids).size, ids.length, 'layer ids are unique');
    for (const layer of style.layers) {
        assert.ok(style.sources[layer.source], `${layer.id} draws from a source the style has`);
        // Filters may compare with the zoom anywhere; paint and layout values may not.
        for (const value of [...Object.values(layer.paint || {}), ...Object.values(layer.layout || {})]) {
            assert.equal(nestedZoom(value), false, `${layer.id}: zoom only at the top of an expression`);
        }
    }
    for (const id of Object.keys(STATUS_LAYERS)) assert.ok(ids.includes(id), `${id} is drawn`);
    for (const source of ['regions', 'journeys', 'cities']) assert.deepEqual(style.sources[source].data, EMPTY);
    const regions = style.layers.filter(layer => layer.source === 'regions');
    assert.deepEqual(regions.map(layer => layer.minzoom), [toMapZoom(REGIONS_MIN_ZOOM), toMapZoom(REGIONS_MIN_ZOOM)]);
    assert.ok(ids.indexOf('region-lines') < ids.indexOf('borders'), 'country borders draw over the regions');
    assert.equal(nestedZoom(['step', ['zoom'], ['match', ['zoom'], 1, 2, 3], 5, 1]), true, 'the check itself catches a nested zoom');
});
