'use strict';

// Regions (public/js/regions.js, scripts/build-regions.js): a state or province counts once a
// town been to lies in it, within its own country, coastal towns included.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { regionFeatures } = require('../scripts/build-regions');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'regions.js'));
const data = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'regions.geojson'), 'utf8'));
const square = (x, y, size = 1) => ({ type: 'Polygon', coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] });

test('the build keeps each region\'s id, names in other languages, kind and country', () => {
    const [feature] = regionFeatures({ features: [{ properties: { adm1_code: 'AUS-1', name: 'Western Australia', name_fr: 'Australie-Occidentale', name_de: 'Western Australia', type_en: 'State', adm0_a3: 'AUS' }, geometry: square(115, -30, 5) }] });
    assert.deepEqual(feature.properties, { id: 'AUS-1', name: 'Western Australia', names: { fr: 'Australie-Occidentale' }, kind: 'State', countryId: 'AUS' });
    assert.equal(feature.geometry.type, 'Polygon');
});

test('towns count for the region they lie in, of their own country, coasts included', async () => {
    const { regionIndex, regionAt, regionProgress } = await load();
    const index = regionIndex(data(), 'fr');
    assert.equal(index.byCountry.get('USA').length, 51);
    assert.equal(regionAt(index, 'USA', 30.27, -97.74).name, 'Texas');
    assert.equal(regionAt(index, 'USA', 40.71, -74.0).name, 'État de New York', 'Manhattan sits on the simplified coastline');
    assert.equal(regionAt(index, 'USA', 21.31, -157.86).id, regionAt(index, 'USA', 19.72, -155.08).id, 'Honolulu and Hilo are both in Hawaii');
    assert.equal(regionAt(index, 'MEX', 32.51, -117.04), null, 'Tijuana is not in California');
    assert.equal(regionAt(index, 'USA', 0, 0), null);
    assert.equal(regionAt(index, 'AUS', -33.87, 151.21).name, 'Nouvelle-Galles du Sud');

    const towns = [
        { id: 1, category: 'City', type: 'visited', name: 'Austin, United States of America', lat: 30.27, lng: -97.74 },
        { id: 2, category: 'City', type: 'visited', stay: 'transit', name: 'Houston', lat: 29.76, lng: -95.37 },
        { id: 3, category: 'City', type: 'wishlist', name: 'Miami', lat: 25.76, lng: -80.19 },
        { id: 4, category: 'Country', type: 'visited', name: 'Canada', lat: 56, lng: -106 },
        { id: 5, category: 'City', type: 'visited', name: 'Sydney', lat: -33.87, lng: 151.21 },
        { id: 6, category: 'City', type: 'visited', name: 'Lisbon', lat: 38.72, lng: -9.14 }
    ];
    const countries = { 1: 'USA', 2: 'USA', 3: 'USA', 4: 'CAN', 5: 'AUS', 6: 'PRT' };
    const progress = regionProgress(index, towns, marker => countries[marker.id]);
    assert.deepEqual(progress.map(({ countryId, total, visited }) => [countryId, total, visited.map(({ region, towns: names }) => [region.name, names])]), [
        ['AUS', 9, [['Nouvelle-Galles du Sud', ['Sydney']]]],
        ['USA', 51, [['Texas', ['Austin', 'Houston']]]]
    ]);
});

test('a tiny map: the nearest region within about 25 km, never farther', async () => {
    const { regionIndex, regionAt } = await load();
    const index = regionIndex({ features: [{ properties: { id: 'A', name: 'A', countryId: 'XXX' }, geometry: { type: 'MultiPolygon', coordinates: [square(0, 0).coordinates] } }] });
    assert.equal(regionAt(index, 'XXX', 0.5, 0.5).id, 'A');
    assert.equal(regionAt(index, 'XXX', 0.5, 1.1).id, 'A');
    assert.equal(regionAt(index, 'XXX', 0.5, 1.5), null);
});

test('zoomed in far enough, the map draws the regions, those with a town been to tinted', async () => {
    const layer = await import(path.join(__dirname, '..', 'public', 'js', 'regions-layer.js'));
    const geojson = data();
    let fetched = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        fetched += 1;
        return { json: async () => geojson };
    };
    try {
        let zoom = 2;
        const listeners = [];
        const drawn = [];
        const austin = { id: 1, category: 'City', type: 'visited', name: 'Austin', lat: 30.27, lng: -97.74 };
        const ctx = {
            state: { markers: [austin], stats: { markerCountry: new Map([[1, { id: 'USA' }]]) } },
            map: { map: { getZoom: () => zoom, on: (event, listener) => listeners.push(listener) }, setRegions: regions => drawn.push(regions) }
        };
        layer.updateRegionsOnMap(ctx);
        assert.equal(fetched, 0, 'nothing loads before zooming in');
        zoom = 5;
        listeners.forEach(listener => listener());
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(fetched, 1);
        const tinted = drawn.at(-1).features.filter(feature => feature.properties.visited).map(feature => feature.properties.name);
        assert.deepEqual(tinted, ['Texas']);
        // A new town redraws without loading again.
        ctx.state.markers.push({ id: 2, category: 'City', type: 'visited', name: 'Sydney', lat: -33.87, lng: 151.21 });
        ctx.state.stats.markerCountry.set(2, { id: 'AUS' });
        layer.updateRegionsOnMap(ctx);
        assert.equal(fetched, 1);
        assert.equal(drawn.at(-1).features.filter(feature => feature.properties.visited).length, 2);
        layer.updateRegionsOnMap({ state: {}, map: null });
    } finally {
        globalThis.fetch = realFetch;
    }
});
