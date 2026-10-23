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
    const withVisits = computeStats([
        { ...markers[0], visits: [{ startDate: '2022-01-01', notes: 'Fun' }, { startDate: '2022-06-01' }, { startDate: '2024-01-01' }] }
    ], index);
    assert.deepEqual(withVisits.years, [{ year: '2022', count: 2 }, { year: '2024', count: 1 }], 'every visit counts');
    assert.equal(withVisits.placesWithNotes, 1, 'visit notes count towards the storyteller badge');

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

    assert.deepEqual(place.visits, [{ startDate: '2024-01-02', endDate: '', notes: '', photoUrl: '', ongoing: false }],
        'an export from before visits turns its travel date into a visit');

    assert.equal(validatePlace({ ...record, photoUrl: 'javascript:alert(1)' }), null);
    assert.equal(validatePlace({ ...record, visitStartDate: '', travelDate: '2024-02-30' }), null);
    assert.equal(validatePlace({ ...record, lat: 120 }), null);
    assert.equal(parseImportContent('places.json', JSON.stringify({ markers: [record] })).length, 1);
    assert.throws(() => parseImportContent('places.txt', ''), /json or \.csv/);
    assert.throws(() => parseImportContent('places.csv', 'name\nParis'), /must include/);
});

test('visits sort newest first and describe how often you have been', async () => {
    const visits = await load('visits.js');
    const marker = {
        travelDate: '2020-01-01',
        visits: [
            { id: 1, startDate: '2019-05-01', endDate: '2019-05-03' },
            { id: 3, startDate: '2023-08-10', endDate: '' },
            { id: 2, startDate: '2023-08-10', endDate: '2023-08-10' }
        ]
    };
    assert.deepEqual(visits.sortVisits(marker.visits).map(visit => visit.id), [3, 2, 1]);
    assert.equal(visits.lastVisitDate(marker), '2023-08-10');
    assert.equal(visits.lastVisitDate({ travelDate: '2020-01-01' }), '2020-01-01', 'older data without visits');
    assert.equal(visits.lastVisitDate({ visits: [] }), '');
    assert.equal(visits.visitCount(marker), 3);
    assert.deepEqual([0, 1, 2, 5].map(visits.visitCountLabel),
        ['No visits recorded yet', 'Visited once', 'Visited 2 times', 'Visited 5 times']);

    // Days are plain calendar days, inclusive, across leap days and with no time zone.
    assert.equal(visits.visitDays({ startDate: '2024-02-28', endDate: '2024-03-01' }), 3);
    assert.equal(visits.visitDays({ startDate: '2024-03-30', endDate: '2024-03-31' }), 2);
    assert.equal(visits.visitDays({ startDate: '2024-01-01', endDate: '' }), null);
    const format = date => `<${date}>`;
    assert.equal(visits.formatVisitDates({ startDate: '2024-01-01', endDate: '2024-01-03' }, format), '<2024-01-01> – <2024-01-03>');
    assert.equal(visits.formatVisitDates({ startDate: '2024-01-01', endDate: '2024-01-01' }, format), '<2024-01-01>');

    assert.deepEqual(visits.checkVisit({ startDate: ' 2024-01-01 ', endDate: '', notes: ' Hi ' }).visit,
        { startDate: '2024-01-01', endDate: '', notes: 'Hi', photoUrl: '', ongoing: false });
    // Still there: a form checkbox or a CSV "yes", and never with a last day.
    assert.equal(visits.checkVisit({ startDate: '2024-01-01', ongoing: 'on' }).visit.ongoing, true);
    assert.equal(visits.checkVisit({ startDate: '2024-01-01', ongoing: true }).visit.ongoing, true);
    assert.match(visits.checkVisit({ startDate: '2024-01-01', endDate: '2024-01-02', ongoing: 'yes' }).error, /still on/);
    assert.equal(visits.formatVisitDates({ startDate: '2024-01-01', endDate: '', ongoing: true }, format), '<2024-01-01> – still there');
    for (const bad of [{}, { startDate: '2024-02-30' }, { startDate: '2024-01-02', endDate: '2024-01-01' },
        { startDate: '2024-01-01', endDate: 'later' }, { startDate: '2024-01-01', notes: 'x'.repeat(2001) },
        { startDate: '2024-01-01', photoUrl: 'ftp://example.com/x' }]) {
        assert.ok(visits.checkVisit(bad).error, JSON.stringify(bad).slice(0, 60));
    }

    const places = [marker, { visits: [{ startDate: '2021-01-01' }] }, { visits: [] }];
    assert.deepEqual(visits.lastVisitYears(places), ['2023', '2021']);
    assert.deepEqual(places.map(place => visits.matchesLastVisit(place, '2023')), [true, false, false]);
    assert.deepEqual(places.map(place => visits.matchesLastVisit(place, 'none')), [false, false, true]);
    assert.ok(visits.matchesLastVisit(places[2], 'all'));
});

test('import and export round-trip every visit in JSON and CSV', async () => {
    const { buildCsv, buildJson, parseImportContent, validatePlace, mergePlaces } = await load('io.js');
    const markers = [
        {
            id: 1, lat: 38.72, lng: -9.14, type: 'visited', name: 'Lisbon, Portugal', category: 'City', photoUrl: '', notes: 'Trams',
            travelDate: '2023-04-01',
            visits: [
                { id: 5, startDate: '2019-06-01', endDate: '2019-06-04', notes: 'First, "sunny"', photoUrl: 'https://example.com/1.jpg' },
                { id: 9, startDate: '2023-04-01', endDate: '', notes: '', photoUrl: '', ongoing: true }
            ]
        },
        { id: 2, lat: 35.68, lng: 139.69, type: 'wishlist', name: 'Japan', category: 'Country', photoUrl: '', notes: '', travelDate: '', visits: [] }
    ];
    const expected = [
        { startDate: '2023-04-01', endDate: '', notes: '', photoUrl: '', ongoing: true },
        { startDate: '2019-06-01', endDate: '2019-06-04', notes: 'First, "sunny"', photoUrl: 'https://example.com/1.jpg', ongoing: false }
    ];

    const fromJson = parseImportContent('places.json', buildJson(markers)).map(validatePlace);
    assert.deepEqual(fromJson[0].visits, expected);
    assert.equal(fromJson[0].travelDate, '2023-04-01');
    assert.deepEqual(fromJson[1].visits, []);

    const csv = buildCsv(markers);
    assert.equal(csv.split('\r\n').length, 4, 'a header, one row per visit and one for the place without visits');
    const rows = parseImportContent('places.csv', csv).map(validatePlace);
    assert.equal(rows.length, 3);
    const merged = mergePlaces(rows);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0].visits, expected);
    assert.equal(merged[0].notes, 'Trams');
    assert.deepEqual(merged[1].visits, []);

    // The same visit listed twice is kept once; a bad visit rejects only its row.
    assert.equal(mergePlaces([...rows, rows[0]])[0].visits.length, 2);
    const [record] = parseImportContent('places.csv', csv);
    assert.equal(validatePlace({ ...record, visitEndDate: '2000-01-01' }), null);
    assert.equal(validatePlace({ ...JSON.parse(buildJson(markers))[0], visits: [{ startDate: 'soon' }] }), null);
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

test('the demo traveler lies on the map and counts Schengen days like a real one', async () => {
    const { createCountryIndex, computeStats } = await load('geo.js');
    const { DEMO_HOME, demoMarkers } = await load('demo.js');
    const { ledgerOverview, SCHENGEN_RULE } = await load('days.js');
    const index = createCountryIndex(countries);
    const today = '2026-10-23';
    const markers = demoMarkers(today);
    const stats = computeStats(markers, index, { homeId: DEMO_HOME });
    assert.ok(markers.every(marker => stats.markerCountry.get(marker.id)), 'every sample place resolves to a country');
    assert.ok(markers.every(marker => marker.id < 0 && marker.visits.every(visit => visit.id < 0)), 'sample ids never clash with saved ones');
    assert.equal(stats.visitedCountries, 10, 'home, a country lived in and eight visited');
    assert.deepEqual([...stats.livedIds].sort(), ['CAN', 'GBR']);
    assert.deepEqual([...stats.transitIds], ['ARE'], 'a layover is shown but not counted');
    assert.equal(stats.wishlistCountries, 3);

    const overview = ledgerOverview({ markers, countryOf: marker => stats.markerCountry.get(marker.id), settings: null, today });
    const schengen = overview.stays.find(item => item.rule.id === SCHENGEN_RULE.id);
    // Lisbon 10, Porto 5, Barcelona 8, France 13 and Rome 5; Greece is older than 180 days.
    assert.equal(schengen.used, 41);
    assert.equal(schengen.inside, true);
    assert.deepEqual(demoMarkers('2027-01-01')[0].visits[0].startDate, '2026-12-23', 'dates follow today');
});

test('the calculator page lists every Schengen member by its map name', async () => {
    const { createCountryIndex } = await load('geo.js');
    const { SCHENGEN_MEMBERS, SCHENGEN_OPEN_BORDERS } = await load('days.js');
    const index = createCountryIndex(countries);
    const html = fs.readFileSync(path.join(publicDir, 'schengen-calculator.html'), 'utf8');
    const listed = [...html.match(/<ul class="member-list">([\s\S]*?)<\/ul>/)[1].matchAll(/<li>([^<]+)<\/li>/g)].map(match => match[1]);
    assert.deepEqual(listed, SCHENGEN_MEMBERS.map(id => index.byId.get(id).name).sort());
    assert.match(html, new RegExp(`has ${SCHENGEN_MEMBERS.length} members`));
    for (const id of SCHENGEN_OPEN_BORDERS) assert.match(html, new RegExp(index.byId.get(id).name));
});

test('place details are checked like the API and filter the list and map', async () => {
    const details = await load('details.js');
    assert.deepEqual(details.checkDetails({ rating: '4', tags: ['Food', 'food'], emoji: ' 🥐 ' }).details,
        { rating: 4, tags: ['food'], emoji: '🥐', priority: null, bestMonths: [] });
    assert.deepEqual(details.checkDetails({}).details, { rating: null, tags: [], emoji: '', priority: null, bestMonths: [] },
        'older files have no details');
    assert.deepEqual(details.splitTags('Street art;  road   trip, ,food'), ['street art', 'road trip', 'food']);
    for (const bad of [{ rating: 6 }, { rating: 'great' }, { tags: 'a,b,c,d,e,f,g,h,i' }, { tags: ['x'.repeat(25)] },
        { tags: ['-dash'] }, { emoji: '😀😀' }, { emoji: 'a' }]) {
        assert.ok(details.checkDetails(bad).error, JSON.stringify(bad));
    }
    assert.ok(details.isSingleEmoji('🇯🇵') && details.isSingleEmoji('👩🏽‍💻') && !details.isSingleEmoji(7));
    assert.equal(details.stars(3), '★★★☆☆');
    assert.equal(details.stars(null), '');
    assert.deepEqual([null, 1, 4].map(details.ratingLabel), ['Not rated', 'Rated 1 star out of 5', 'Rated 4 stars out of 5']);

    const markers = [
        { id: 1, rating: 5, tags: ['food', 'street art'] },
        { id: 2, rating: 3, tags: ['hiking', 'street art'] },
        { id: 3, tags: [] },
        { id: 4 }
    ];
    assert.deepEqual(details.knownTags(markers), [...details.SUGGESTED_TAGS, 'street art']);
    assert.deepEqual(details.usedTags(markers), ['food', 'hiking', 'street art']);
    const ids = filters => markers.filter(marker => details.matchesDetails(marker, filters)).map(marker => marker.id);
    assert.deepEqual(ids({ tag: 'street art', rating: 'all' }), [1, 2]);
    assert.deepEqual(ids({ tag: 'all', rating: '4' }), [1]);
    assert.deepEqual(ids({ tag: 'all', rating: 'none' }), [3, 4]);
    assert.deepEqual(ids({}), [1, 2, 3, 4]);
    assert.ok(!details.detailFilterActive({ tag: 'all', rating: 'all' }) && details.detailFilterActive({ tag: 'food' }));
    assert.equal(details.describeDetailFilter({ tag: 'food', rating: '3' }), '#food · ★3+');
    assert.equal(details.describeDetailFilter({ rating: '5' }), '★5');
    assert.equal(details.describeDetailFilter({ rating: 'none' }), 'not rated');
});

test('import and export round-trip ratings, tags, emoji and hidden places, and read older files', async () => {
    const { buildCsv, buildJson, parseImportContent, validatePlace, mergePlaces } = await load('io.js');
    const markers = [{
        id: 1, lat: 41.9, lng: 12.5, type: 'visited', name: 'Rome, Italy', category: 'City', photoUrl: '', notes: '',
        rating: 5, tags: ['food', 'street art'], emoji: '🍝', hideFromPublic: true,
        visits: [{ startDate: '2022-02-02' }, { startDate: '2023-03-03' }]
    }];
    for (const [file, content] of [['places.json', buildJson(markers)], ['places.csv', buildCsv(markers)]]) {
        const [place] = mergePlaces(parseImportContent(file, content).map(validatePlace));
        assert.deepEqual([place.rating, place.tags, place.emoji, place.hideFromPublic, place.visits.length],
            [5, ['food', 'street art'], '🍝', true, 2], file);
    }
    assert.match(buildCsv(markers), /"food; street art"/);
    const old = 'lat,lng,type,name,category,notes,travelDate\n41.9,12.5,visited,Rome,City,,2020-01-01';
    const [place] = parseImportContent('old.csv', old).map(validatePlace);
    assert.deepEqual([place.rating, place.tags, place.emoji, place.hideFromPublic], [null, [], '', false]);
    assert.equal(validatePlace({ ...JSON.parse(buildJson(markers))[0], emoji: 'pizza' }), null, 'an invalid detail skips the row');
});

test('country status counts only the places passed in', async () => {
    const { createCountryIndex, computeStats, countryStatus } = await load('geo.js');
    const index = createCountryIndex(countries);
    const markers = [
        { id: 1, lat: 46, lng: 2, type: 'visited', name: 'France', category: 'Country', tags: ['food'] },
        { id: 2, lat: 35.68, lng: 139.69, type: 'wishlist', name: 'Japan', category: 'Country', tags: [] }
    ];
    const stats = computeStats(markers, index);
    const status = countryStatus(markers.filter(marker => marker.tags.includes('food')), marker => stats.markerCountry.get(marker.id));
    assert.deepEqual([[...status.visitedIds], [...status.wishlistIds]], [['FRA'], []]);
});

test('wishlist places sort by the next month that suits them', async () => {
    const details = await load('details.js');
    const labels = [[11, 12, 1, 2], [3, 9], [4, 5, 6], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], []].map(months => details.monthsLabel(months));
    assert.deepEqual(labels, ['Nov–Feb', 'Mar, Sep', 'Apr–Jun', 'All year', ''], 'runs of months wrap past December');
    assert.equal(details.monthsUntil([1, 11], 10), 1);
    assert.equal(details.monthsUntil([10], 10), 0);
    assert.equal(details.monthsUntil([9], 10), 11, 'a month just gone is the furthest away');
    assert.equal(details.monthsUntil([], 10), null);
    assert.deepEqual(details.checkMonths('4;5; 6').months, [4, 5, 6]);
    assert.ok(details.checkMonths(['13']).error);
    assert.ok(details.checkDetails({ priority: 'urgent' }).error);
    assert.equal(details.priorityLabel('high'), '🔥 Must go');
    assert.equal(details.priorityLabel(null), '');

    const markers = [
        { name: 'Peru', type: 'wishlist', bestMonths: [11, 12, 1], priority: 'low' },
        { name: 'Japan', type: 'wishlist', bestMonths: [3, 4, 11], priority: 'high' },
        { name: 'Iceland', type: 'wishlist', bestMonths: [6, 7] },
        { name: 'Chile', type: 'wishlist', bestMonths: [] },
        { name: 'Oman', type: 'wishlist', bestMonths: [10], priority: 'medium' },
        { name: 'Spain', type: 'visited', bestMonths: [10], priority: 'high' }
    ];
    const groups = details.groupByNextMonth(markers.filter(marker => marker.type === 'wishlist'), 10);
    assert.deepEqual(groups.map(([title, items]) => [title, items.map(item => item.name)]), [
        ['October (this month)', ['Oman']],
        ['November (next month)', ['Japan', 'Peru']],
        ['June', ['Iceland']],
        ['No month chosen', ['Chile']]
    ]);
    assert.equal(details.groupByNextMonth(markers.slice(0, 1), 12)[0][0], 'December (this month)');
    assert.equal(details.nextInSeason(markers, 10).name, 'Oman', 'visited places are never suggested');
    assert.equal(details.nextInSeason(markers, 2).name, 'Japan');
    assert.equal(details.nextInSeason([{ name: 'Chile', type: 'wishlist' }], 2), null);

    const { buildCsv, buildJson, parseImportContent, validatePlace } = await load('io.js');
    const wish = [{ id: 1, lat: 36, lng: 138, type: 'wishlist', name: 'Japan', category: 'Country', priority: 'high', bestMonths: [3, 4, 11], visits: [] }];
    for (const [file, content] of [['places.json', buildJson(wish)], ['places.csv', buildCsv(wish)]]) {
        const [place] = parseImportContent(file, content).map(validatePlace);
        assert.deepEqual([place.priority, place.bestMonths], ['high', [3, 4, 11]], file);
    }
    assert.match(buildCsv(wish), /"3;4;11"/);
});

test('bulk marking plans one change for many countries and its undo', async () => {
    const bulk = await load('bulk.js');
    const country = (id, name) => ({ id, name, label: [10, 20] });
    const countries = [country('FRA', 'France'), country('ESP', 'Spain'), country('ITA', 'Italy'), country('PRT', 'Portugal'), country('DEU', 'Germany')];
    const saved = { ESP: { id: 7, type: 'wishlist' }, ITA: { id: 8, type: 'visited' } };
    const countryMarkerOf = item => saved[item.id];

    const visited = bulk.planBulkMark({ countries, type: 'visited', countryMarkerOf, visitedIds: new Set(['ITA', 'PRT']) });
    assert.deepEqual(visited.create.map(place => place.name), ['France', 'Portugal', 'Germany'],
        'a country visited only through a city gets its own place');
    assert.deepEqual(visited.create[0], { lat: 10, lng: 20, name: 'France', category: 'Country', type: 'visited' });
    assert.deepEqual(visited.update, [{ id: 7, type: 'visited', stay: 'visit', previous: { type: 'wishlist', stay: 'visit' } }]);
    assert.equal(visited.unchanged, 1);
    assert.deepEqual(bulk.bulkRequest(visited).update, [{ id: 7, type: 'visited', stay: 'visit' }]);
    assert.equal(bulk.bulkSummary(visited, 'visited'), 'Marked 4 countries as been there (1 already colored in).');

    const wishlist = bulk.planBulkMark({ countries, type: 'wishlist', countryMarkerOf, visitedIds: new Set(['ITA', 'PRT']) });
    assert.deepEqual(wishlist.create.map(place => place.name), ['France', 'Germany'], 'a wishlist never replaces a visit');
    assert.deepEqual(wishlist.update, []);
    assert.equal(wishlist.unchanged, 3);
    assert.equal(bulk.bulkSummary({ create: [{}], update: [], unchanged: 0 }, 'wishlist'), 'Marked 1 country as wishlist.');

    const result = { created: [{ id: 20, name: 'France' }, { id: 21, name: 'Portugal' }, { id: 22, name: 'Germany' }], updated: [{ id: 7, type: 'visited' }], removed: [] };
    assert.deepEqual(bulk.undoRequest(visited, result), { remove: [20, 21, 22], update: [{ id: 7, type: 'wishlist', stay: 'visit' }] });
    const markers = [{ id: 7, type: 'wishlist' }, { id: 8, type: 'visited' }];
    const after = bulk.applyBulkResult(markers, result);
    assert.deepEqual(after.map(marker => [marker.id, marker.type]), [[7, 'visited'], [8, 'visited'], [20, undefined], [21, undefined], [22, undefined]]);
    const undone = bulk.applyBulkResult(after, { created: [], updated: [{ id: 7, type: 'wishlist' }], removed: [20, 21, 22] });
    assert.deepEqual(undone, markers);
    assert.deepEqual(bulk.applyBulkResult(markers, {}), markers);
});

test('home, lived-there and transit-only places are drawn and counted apart (ADR 0014)', async () => {
    const { createCountryIndex, computeStats, countryLook, countryStatus } = await load('geo.js');
    const status = await load('status.js');
    const { visitCountLabel } = await load('visits.js');
    const bulk = await load('bulk.js');
    const index = createCountryIndex(countries);
    const markers = [
        { id: 1, lat: 52.52, lng: 13.4, type: 'visited', stay: 'lived', name: 'Berlin, Germany', category: 'City', visits: [{ startDate: '2015-09-01' }] },
        { id: 2, lat: 25.2, lng: 55.27, type: 'visited', stay: 'transit', name: 'Dubai, United Arab Emirates', category: 'City', visits: [{ startDate: '2019-01-01' }] },
        { id: 3, lat: 46, lng: 2, type: 'visited', name: 'France', category: 'Country', visits: [{ startDate: '2020-01-01' }] },
        { id: 4, lat: 48.85, lng: 2.35, type: 'visited', name: 'Paris, France', category: 'City' },
        { id: 5, lat: 41.9, lng: 12.5, type: 'visited', name: 'Rome, Italy', category: 'City' },
        { id: 6, lat: 25.3, lng: 51.5, type: 'visited', stay: 'transit', name: 'Doha, Qatar', category: 'City' },
        { id: 7, lat: 25.3, lng: 51.2, type: 'wishlist', name: 'Qatar', category: 'Country' },
        { id: 8, lat: 25.2, lng: 55.3, type: 'wishlist', stay: 'lived', name: 'United Arab Emirates', category: 'Country' }
    ];
    const stats = computeStats(markers, index, { homeId: 'PRT' });
    assert.deepEqual([...stats.visitedIds].sort(), ['DEU', 'FRA', 'ITA', 'PRT'], 'home and lived count as been to; layovers do not');
    assert.deepEqual([stats.visitedCountries, stats.livedCountries, stats.transitCountries], [4, 2, 2]);
    assert.equal(stats.wishlistCountries, 0, 'a layover wins over a wish');
    assert.equal(stats.visitedCities, 3, 'cities lived in count, layovers do not');
    assert.deepEqual(stats.years, [{ year: '2020', count: 1 }], 'stays lived in and layovers are not visits');
    assert.deepEqual(['PRT', 'DEU', 'FRA', 'ITA', 'ARE', 'QAT', 'ESP'].map(id => countryLook(id, stats)),
        ['home', 'lived', 'visited', 'cityOnly', 'transit', 'transit', null]);
    const hidden = { visited: false, lived: false, transit: true, wishlist: true };
    assert.deepEqual(['PRT', 'DEU', 'FRA', 'QAT'].map(id => countryLook(id, stats, hidden)), ['home', null, null, 'transit'],
        'the legend hides statuses but never the home country');
    assert.equal(computeStats(markers, index, { homeId: 'XXX' }).homeId, null, 'an unknown home country is ignored');
    const expat = computeStats(markers, index, { homeId: 'PRT' }).achievements.find(badge => badge.id === 'expat');
    assert.equal(expat.unlocked, true);
    const onlyWishes = countryStatus([markers[6]], marker => stats.markerCountry.get(marker.id), { homeId: 'QAT' });
    assert.deepEqual([[...onlyWishes.wishlistIds], [...onlyWishes.livedIds]], [[], ['QAT']], 'home is never a wish');

    assert.deepEqual(markers.map(status.statusOf), ['lived', 'transit', 'visited', 'visited', 'visited', 'transit', 'wishlist', 'wishlist']);
    assert.deepEqual(status.statusFields('transit'), { type: 'visited', stay: 'transit' });
    assert.deepEqual(status.statusFields('wishlist'), { type: 'wishlist', stay: 'visit' });
    assert.equal(status.statusLabel('lived'), '🔑 Lived there');
    assert.equal(status.countsAsBeen(markers[1]), false);
    assert.equal(visitCountLabel(2, 'lived'), 'Lived here 2 times');
    assert.equal(visitCountLabel(1, 'transit'), 'Passed through once');
    assert.equal(visitCountLabel(0, 'transit'), 'No layovers recorded yet');

    // Marking countries "been there" turns a layover into a visit but leaves homes alone.
    const list = [{ id: 'ARE', name: 'UAE', label: [1, 2] }, { id: 'DEU', name: 'Germany', label: [1, 2] }, { id: 'PRT', name: 'Portugal', label: [1, 2] }];
    const saved = { ARE: { id: 2, type: 'visited', stay: 'transit' }, DEU: { id: 9, type: 'visited', stay: 'lived' } };
    const plan = bulk.planBulkMark({ countries: list, type: 'visited', countryMarkerOf: country => saved[country.id], homeId: 'PRT' });
    assert.deepEqual(plan.update, [{ id: 2, type: 'visited', stay: 'visit', previous: { type: 'visited', stay: 'transit' } }]);
    assert.equal(plan.unchanged, 2);
    assert.deepEqual(bulk.undoRequest(plan, { created: [] }).update, [{ id: 2, type: 'visited', stay: 'transit' }]);
    const wishes = bulk.planBulkMark({ countries: [...list, { id: 'QAT', name: 'Qatar', label: [1, 2] }], type: 'wishlist',
        countryMarkerOf: () => undefined, visitedIds: stats.visitedIds, transitIds: stats.transitIds });
    assert.deepEqual(wishes.create.map(place => place.name), [], 'a wish never replaces a layover, a home or a visit');
});

test('import and export keep whether a place was lived in or passed through', async () => {
    const io = await load('io.js');
    const markers = [
        { id: 1, lat: 52.52, lng: 13.4, type: 'visited', stay: 'lived', name: 'Berlin, Germany', category: 'City', visits: [{ startDate: '2015-09-01', endDate: '2019-06-30' }] },
        { id: 2, lat: 25.2, lng: 55.27, type: 'visited', stay: 'transit', name: 'Dubai, United Arab Emirates', category: 'City', visits: [] },
        { id: 3, lat: 46, lng: 2, type: 'wishlist', name: 'France', category: 'Country', visits: [] }
    ];
    const fromJson = JSON.parse(io.buildJson(markers)).map(io.validatePlace);
    assert.deepEqual(fromJson.map(place => place.stay), ['lived', 'transit', 'visit']);
    const fromCsv = io.mergePlaces(io.parseCsv(io.buildCsv(markers)).map(io.validatePlace));
    assert.deepEqual(fromCsv.map(place => [place.name, place.stay]), markers.map(marker => [marker.name, marker.stay || 'visit']));
    assert.equal(io.validatePlace({ ...markers[0], stay: 'LIVED' }).stay, 'lived');
    assert.equal(io.validatePlace({ ...markers[0], stay: undefined }).stay, 'visit', 'older files are plain visits');
    assert.equal(io.validatePlace({ ...markers[0], stay: 'home' }), null);
    assert.equal(io.validatePlace({ ...markers[2], stay: 'transit' }), null, 'a wish is never a layover');
});

test('the passport counts against every territory or the UN list, by a documented rule (ADR 0015)', async () => {
    const { createCountryIndex, computeStats } = await load('geo.js');
    const lists = await load('lists.js');
    const index = createCountryIndex(countries);
    const ids = new Set(index.countries.map(country => country.id));

    assert.equal(lists.UN_MEMBERS.length, 193);
    assert.equal(new Set(lists.UN_MEMBERS).size, 193);
    assert.deepEqual(lists.UN_OBSERVERS, ['VAT', 'PSX']);
    assert.deepEqual([...lists.UN_MEMBERS, ...lists.UN_OBSERVERS].filter(id => !ids.has(id)), [], 'every UN country is on the map');
    assert.equal(lists.countedCountries(index, 'un').length, 195);
    assert.equal(lists.countedCountries(index, 'all').length, index.countries.length);
    assert.equal(lists.countedCountries(index, 'nonsense').length, index.countries.length, 'an unknown list counts everything');
    // Disputed and partially recognized territories the map draws on their own.
    for (const id of ['KOS', 'TWN', 'SAH', 'PSX', 'CYN', 'SOL', 'KAS']) assert.ok(ids.has(id), id);
    const un = new Set(lists.countedCountries(index, 'un').map(country => country.id));
    assert.deepEqual(['KOS', 'TWN', 'SAH', 'CYN', 'SOL', 'KAS', 'GRL', 'HKG', 'PRI'].filter(id => un.has(id)), []);
    assert.deepEqual(['PSX', 'VAT', 'SRB', 'CHN', 'MAR', 'CYP', 'SOM', 'SDS'].filter(id => !un.has(id)), []);

    const markers = [
        { id: 1, lat: 42.6, lng: 21.0, type: 'visited', name: 'Kosovo', category: 'Country' },
        { id: 2, lat: 44.8, lng: 20.5, type: 'visited', name: 'Serbia', category: 'Country' },
        { id: 3, lat: 25.03, lng: 121.56, type: 'visited', name: 'Taipei, Taiwan', category: 'City' },
        { id: 4, lat: 31.9, lng: 35.2, type: 'visited', name: 'Ramallah, Palestine', category: 'City' }
    ];
    const all = computeStats(markers, index);
    const unStats = computeStats(markers, index, { countryList: 'un' });
    assert.equal(all.countryList, 'all');
    assert.deepEqual([all.visitedCountries, all.totalCountries], [4, index.countries.length]);
    assert.deepEqual([unStats.visitedCountries, unStats.totalCountries], [2, 195]);
    assert.equal(unStats.worldPercent, 1);
    assert.deepEqual(unStats.uncountedIds.sort(), ['KOS', 'TWN'], 'territories left out are named, never moved to another country');
    assert.ok(unStats.visitedIds.has('KOS'), 'the map still colors them in');
    assert.equal(unStats.continents.reduce((sum, continent) => sum + continent.total, 0), 195);
    assert.equal(lists.shareLabel('un'), 'of UN countries');
    assert.equal(lists.shareLabel('all'), 'of the world');
});
