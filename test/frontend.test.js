// Unit tests for the browser modules that hold pure logic (geography, stats, import/export, guide parsing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const load = file => import(path.join(publicDir, 'js', file));
const countries = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'countries.geojson'), 'utf8'));
const cities = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'cities.json'), 'utf8'));

test('map data holds every town, graded by the zoom that reveals it', () => {
    assert.ok(countries.features.length > 200);
    assert.ok(countries.features.every(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)));
    // The base list loads with the page: capitals and cities shown up to zoom 6.
    assert.ok(cities.length > 3000 && cities.length < 8000);
    assert.ok(cities.filter(city => city.capital).length > 150);
    assert.ok(cities.every(city => Number.isFinite(city.minZoom) && city.minZoom <= 6));

    // Everything smaller lives in region tiles as [name, countryId, capital, population, minZoom, lat, lng].
    const tileDir = path.join(publicDir, 'data', 'cities');
    const index = JSON.parse(fs.readFileSync(path.join(tileDir, 'index.json'), 'utf8'));
    const minZooms = cities.map(city => city.minZoom);
    for (const tile of index) {
        const rows = JSON.parse(fs.readFileSync(path.join(tileDir, `${tile.id}.json`), 'utf8'));
        const [south, west, north, east] = tile.bounds;
        for (const [name, countryId, , , minZoom, lat, lng] of rows) {
            assert.ok(name && countryId && minZoom > 6, `${name} belongs in a tile`);
            assert.ok(lat >= south && lat <= north && lng >= west && lng <= east, `${name} lies inside its tile`);
            minZooms.push(minZoom);
        }
    }
    assert.ok(minZooms.length > 200_000, 'every GeoNames town of 500+ people is included');
    const revealedBy = zoom => minZooms.filter(minZoom => minZoom <= zoom).length;
    for (let zoom = 3; zoom < 11; zoom += 1) assert.ok(revealedBy(zoom) < revealedBy(zoom + 1), `zoom ${zoom + 1} adds towns`);
});

test('country index finds countries by name, alias and location', async () => {
    const { createCountryIndex, flagEmoji } = await load('geo.js');
    const index = createCountryIndex(countries);

    assert.equal(index.findByName('France').id, 'FRA');
    assert.equal(index.findByName('United States of America').id, 'USA');
    assert.equal(index.findByName('usa').id, 'USA');
    assert.equal(index.findByName('Czech Republic').id, 'CZE');
    assert.equal(index.findByName('Republic of Serbia').id, 'SRB');
    assert.equal(index.findByName('Côte d’Ivoire').id, 'CIV');
    assert.equal(index.findByName('Atlantis'), null);

    assert.equal(index.findAt(48.86, 2.35).id, 'FRA');
    assert.equal(index.findAt(-33.87, 151.21).id, 'AUS');
    assert.equal(index.findAt(0, -30), null, 'mid-Atlantic is ocean');

    assert.equal(index.search('ger')[0].name, 'Germany');
    assert.equal(flagEmoji('FR'), '🇫🇷');
    assert.equal(flagEmoji(''), '🏳️');

    const france = index.byId.get('FRA');
    assert.ok(france.mainBounds[0] > -10, 'France frames the mainland, not French Guiana');
});

test('stats count visited countries, cities and badges', async () => {
    const { createCountryIndex, computeStats } = await load('geo.js');
    const index = createCountryIndex(countries);
    const markers = [
        { id: 1, lat: 46, lng: 2, type: 'visited', name: 'France', category: 'Country', travelDate: '2023-04-01' },
        { id: 2, lat: 38.72, lng: -9.14, type: 'visited', name: 'Lisbon, Portugal', category: 'City', notes: 'Pastéis' },
        { id: 3, lat: 35.68, lng: 139.69, type: 'wishlist', name: 'Japan', category: 'Country' },
        { id: 4, lat: 46, lng: 2, type: 'wishlist', name: 'France', category: 'Country' }
    ];
    const stats = computeStats(markers, index, { trips: 1 });

    assert.equal(stats.visitedCountries, 2, 'a visited city colors in its country');
    assert.ok(stats.cityOnlyIds.has('PRT'));
    assert.deepEqual([...stats.wishlistIds], ['JPN'], 'visited countries drop off the wishlist');
    assert.equal(stats.visitedCities, 1);
    assert.equal(stats.visitedContinents, 1);
    assert.deepEqual(stats.years, [{ year: '2023', count: 1 }]);
    assert.equal(stats.rank.title, 'Day tripper');
    const unlocked = stats.achievements.filter(a => a.unlocked).map(a => a.id);
    assert.deepEqual(unlocked, ['first-stamp', 'planner']);
});

test('city search prefers exact and bigger matches', async () => {
    const { searchCities } = await load('geo.js');
    assert.equal(searchCities(cities, 'paris')[0].country, 'France');
    assert.equal(searchCities(cities, 'san')[0].name.startsWith('San'), true);
    assert.deepEqual(searchCities(cities, ''), []);
    // A comma or "in" narrows by country.
    for (const query of ['paris, united states', 'paris in united']) {
        const found = searchCities(cities, query);
        assert.ok(found.length > 0 && found.every(city => city.country === 'United States of America'), query);
    }
});

test('import and export round-trip saved places', async () => {
    const { buildCsv, parseImportContent, validatePlace, placeKey } = await load('io.js');
    const markers = [
        { id: 1, lat: 48.86, lng: 2.35, type: 'visited', name: 'Paris, "City of Light"', category: 'City', photoUrl: '', notes: 'Line one\nline two', travelDate: '2024-01-02' }
    ];
    const [record] = parseImportContent('places.csv', buildCsv(markers));
    const place = validatePlace(record);
    assert.equal(place.name, 'Paris, "City of Light"');
    assert.equal(place.notes, 'Line one\nline two');
    assert.equal(place.travelDate, '2024-01-02');
    assert.equal(placeKey(place), placeKey(markers[0]));

    assert.equal(validatePlace({ ...record, photoUrl: 'javascript:alert(1)' }), null);
    assert.equal(validatePlace({ ...record, travelDate: '2024-02-30' }), null);
    assert.equal(validatePlace({ ...record, lat: 120 }), null);
    assert.equal(parseImportContent('places.json', JSON.stringify({ markers: [record] })).length, 1);
    assert.throws(() => parseImportContent('places.txt', ''), /json or \.csv/);
    assert.throws(() => parseImportContent('places.csv', 'name\nParis'), /must include/);
});

test('Wikivoyage listings become itinerary ideas', async () => {
    const { parseWikivoyageListings, buildItinerary, stripWikiMarkup } = await load('ideas.js');
    const wikitext = `
== Cities ==
* [[Lisbon]] — the hilly, [[tram]]-rattling capital
* [[Porto]] – port wine and azulejos

== See ==
* {{see | name=Castelo de São Jorge | alt= | url=https://example.com | content=Hilltop '''castle''' with [[view]]s. }}
* {{listing | type=do | name=Tram 28 | content=Classic yellow tram ride.}}

== Eat ==
* {{eat | name=Time Out Market | content=Food hall. }}
`;
    const ideas = parseWikivoyageListings(wikitext);
    assert.deepEqual(ideas.destinations.map(item => item.name), ['Lisbon', 'Porto']);
    assert.equal(ideas.destinations[0].description, 'the hilly, tram-rattling capital');
    assert.deepEqual(ideas.see, [{ name: 'Castelo de São Jorge', description: 'Hilltop castle with views.' }]);
    assert.equal(ideas.do[0].name, 'Tram 28');
    assert.equal(ideas.eat[0].name, 'Time Out Market');

    const plan = buildItinerary(ideas, 2);
    assert.equal(plan.length, 2);
    assert.match(plan[0].morning, /^Castelo de São Jorge/);
    assert.match(plan[0].evening, /^Time Out Market/);
    assert.equal(plan[1].evening, '');
    assert.equal(stripWikiMarkup('[[Foo|Bar]] {{tmpl}} <b>x</b>'), 'Bar x');
});
