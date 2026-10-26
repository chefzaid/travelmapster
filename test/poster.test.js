// Unit tests for map posters (public/js/poster.js), against the real map data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const load = () => import(path.join(publicDir, 'js', 'poster.js'));
const countries = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'countries.geojson'), 'utf8')).features;

test('the Equal Earth projection is centred and symmetric', async () => {
    const { equalEarth } = await load();
    assert.deepEqual(equalEarth([0, 0]), [0, 0]);
    const [east, north] = equalEarth([180, 90]);
    const [west, south] = equalEarth([-180, -90]);
    assert.ok(Math.abs(east + west) < 1e-12 && Math.abs(north + south) < 1e-12);
    // The equator is about twice as long as a meridian, as on the globe.
    assert.ok(Math.abs(2 * equalEarth([180, 0])[0] / (2 * equalEarth([0, 90])[1]) - 2.05) < 0.01);
});

test('a poster draws every country in its status colour, in the chosen size and style', async () => {
    const { posterSvg, POSTER_STYLES, POSTER_SIZES } = await load();
    const statuses = { PRT: 'home', ESP: 'visited', JPN: 'wishlist', DEU: 'lived', ARE: 'transit' };
    const svg = posterSvg({
        countries, statusOf: id => statuses[id] || null,
        counts: { home: 1, visited: 1, wishlist: 1, lived: 1 }, cities: [[-9.14, 38.72], [2.35, 48.86]],
        size: 'a2', style: 'night', title: 'Ana & Bo’s <map>', subtitle: '4 countries'
    });
    assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="594mm" height="420mm" viewBox="0 0 594 420">'));
    assert.ok(svg.trimEnd().endsWith('</svg>'));
    assert.equal(svg.match(/<path /g).length, countries.length);
    assert.equal(svg.match(/<circle /g).length, 2);
    const night = POSTER_STYLES.night;
    for (const [id, status] of Object.entries(statuses)) {
        const name = countries.find(feature => feature.properties.id === id).properties.name;
        assert.match(svg, new RegExp(`fill="${night[status]}"><title>${name}</title>`), `${name} is ${status}`);
    }
    assert.ok(svg.includes('<title>Ana &amp; Bo’s &lt;map&gt;</title>'));
    assert.ok(svg.includes('>4 countries</text>'));
    // The legend lists the statuses that have places, with their counts.
    assert.ok(svg.includes('Home · 1') && svg.includes('Lived there · 1') && !svg.includes('Transit only'));
    // Every point lies on the page.
    const numbers = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
    assert.ok(numbers.length > 10_000);
    assert.ok(numbers.every(([x, y]) => x >= 0 && x <= 594 && y >= 0 && y <= 420));
    // Unknown sizes and styles fall back to A3 and the cartoon style.
    const fallback = posterSvg({ countries: countries.slice(0, 1), statusOf: () => null, size: 'huge', style: 'neon', title: 'x' });
    assert.ok(fallback.includes('viewBox="0 0 420 297"') && fallback.includes(POSTER_STYLES.cartoon.background));
    assert.deepEqual(POSTER_SIZES.map(item => item.id), ['a4', 'a3', 'a2', '50x70', '18x24']);
});
