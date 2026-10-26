// Unit tests for the passport's collections and their badges (public/js/collections.js and
// computeStats in public/js/geo.js), against the real map data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const load = file => import(path.join(publicDir, 'js', file));
const countries = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'countries.geojson'), 'utf8'));
const cities = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'cities.json'), 'utf8'));
const capitals = cities.filter(city => city.capital);

const city = (id, name, lat, lng, fields = {}) => ({ id, name, category: 'City', lat, lng, type: 'visited', stay: 'visit', visits: [], ...fields });

test('capitals count once per country, by name or nearness, on the chosen list', async () => {
    const { createCountryIndex, computeStats } = await load('geo.js');
    const index = createCountryIndex(countries);
    const markers = [
        city(1, 'Lisbon, Portugal', 38.72, -9.14),
        // The Hague and Amsterdam are both capitals of the Netherlands: one country.
        city(2, 'Amsterdam, Netherlands', 52.37, 4.89),
        city(3, 'The Hague, Netherlands', 52.08, 4.31),
        // A capital by nearness, whatever the saved name.
        city(4, 'Downtown, Japan', 35.69, 139.69),
        city(5, 'Porto, Portugal', 41.15, -8.61),
        // Lived in counts; a layover and a wish do not.
        city(6, 'Berlin, Germany', 52.52, 13.4, { stay: 'lived' }),
        city(7, 'Doha, Qatar', 25.29, 51.53, { stay: 'transit' }),
        city(8, 'Paris, France', 48.86, 2.35, { type: 'wishlist' }),
        // Pristina is Kosovo's capital, which the UN list leaves out.
        city(9, 'Pristina, Kosovo', 42.67, 21.17)
    ];
    const all = computeStats(markers, index, { capitals }).collections.find(item => item.id === 'capitals');
    assert.equal(all.count, 5);
    assert.equal(all.total, new Set(capitals.map(item => item.countryId)).size);
    const un = computeStats(markers, index, { capitals, countryList: 'un' }).collections.find(item => item.id === 'capitals');
    assert.equal(un.count, 4);
    assert.ok(un.total < all.total);
    assert.ok(!un.missing.includes('PRT') && un.missing.includes('FRA'));
    // Without the capitals list (an old caller), the collection is simply empty.
    assert.equal(computeStats(markers, index).collections[0].total, 0);
});

test('the European Union collection and the collection badges', async () => {
    const { createCountryIndex, computeStats } = await load('geo.js');
    const { EU_MEMBERS } = await load('collections.js');
    const index = createCountryIndex(countries);
    assert.equal(EU_MEMBERS.length, 27);
    assert.ok(EU_MEMBERS.every(id => index.byId.has(id)), 'every member is on the map');

    const country = (id, countryId) => {
        const found = index.byId.get(countryId);
        return { id, name: found.name, category: 'Country', lat: found.label[0], lng: found.label[1], type: 'visited', stay: 'visit', visits: [] };
    };
    const almost = EU_MEMBERS.slice(0, 25).map((id, i) => country(i + 1, id));
    const partial = computeStats(almost, index, { capitals });
    const eu = partial.collections.find(item => item.id === 'eu');
    assert.deepEqual([eu.count, eu.total, eu.missing], [25, 27, ['SVN', 'ESP', 'SWE'].filter(id => !EU_MEMBERS.slice(0, 25).includes(id))]);
    assert.equal(partial.achievements.find(badge => badge.id === 'european').unlocked, false);

    const complete = computeStats(EU_MEMBERS.map((id, i) => country(i + 1, id)), index, { capitals });
    assert.equal(complete.achievements.find(badge => badge.id === 'european').unlocked, true);

    const tenCapitals = capitals.filter((item, i, list) => list.findIndex(other => other.countryId === item.countryId) === i).slice(0, 10)
        .map((item, i) => city(i + 1, `${item.name}, ${item.country}`, item.lat, item.lng));
    const stats = computeStats(tenCapitals, index, { capitals });
    assert.equal(stats.achievements.find(badge => badge.id === 'capital-collector').unlocked, true);
    assert.equal(stats.achievements.find(badge => badge.id === 'capital-connoisseur').unlocked, false);
});
