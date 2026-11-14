#!/usr/bin/env node
// Builds public/data/regions.geojson, the states, provinces and regions of the largest
// countries that Natural Earth's 1:50m admin-1 layer covers (public domain,
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson), simplified like the
// country borders, with each region's name in the app's languages.
//
// Usage: node scripts/build-regions.js path/to/ne_50m_admin_1_states_provinces.geojson
const fs = require('node:fs');
const path = require('node:path');
const { simplifyGeometry } = require('./geometry');

const LOCALES = ['fr', 'es', 'de', 'ar'];

/** The regions as compact features: id, name, names by language, kind and country. */
function regionFeatures(source) {
    return source.features
        .map(({ properties: p, geometry }) => ({
            type: 'Feature',
            properties: {
                id: p.adm1_code,
                name: p.name,
                names: Object.fromEntries(LOCALES.map(locale => [locale, p[`name_${locale}`]]).filter(([, name]) => name && name !== p.name)),
                kind: p.type_en,
                countryId: p.adm0_a3
            },
            geometry: simplifyGeometry(geometry)
        }))
        .filter(feature => feature.geometry.coordinates.length)
        .sort((a, b) => a.properties.countryId.localeCompare(b.properties.countryId) || a.properties.name.localeCompare(b.properties.name));
}

if (require.main === module) {
    const [source] = process.argv.slice(2);
    if (!source) {
        console.error('Usage: node scripts/build-regions.js path/to/ne_50m_admin_1_states_provinces.geojson');
        process.exit(1);
    }
    const features = regionFeatures(JSON.parse(fs.readFileSync(source, 'utf8')));
    const target = path.join(__dirname, '..', 'public', 'data', 'regions.geojson');
    fs.writeFileSync(target, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`);
    console.log(`Wrote ${features.length} regions of ${new Set(features.map(feature => feature.properties.countryId)).size} countries to ${target}`);
}

module.exports = { regionFeatures };
