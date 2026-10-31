'use strict';

// Who came along on a visit (public/js/companions.js), as the visit form, the import, the
// filter and the API read the names (src/validation-text.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseCompanions } = require('../src/validation-text');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

test('names are read from a list or one field, each once regardless of case', async () => {
    const { readCompanions } = await load('companions.js');
    assert.deepEqual(readCompanions(' Sam,  Alex   Doe ; sam، Mona,, '), ['Sam', 'Alex Doe', 'Mona']);
    assert.deepEqual(readCompanions(['Sam', ' sam ', '', null]), ['Sam']);
    assert.deepEqual(readCompanions(undefined), []);
    assert.deepEqual(readCompanions(''), []);
    // The API reads them the same way.
    assert.deepEqual(parseCompanions(['Sam', ' Alex   Doe ', 'SAM']), { companions: ['Sam', 'Alex Doe'] });
});

test('a visit lists at most ten people of forty characters each', async () => {
    const { companionsError } = await load('companions.js');
    assert.equal(companionsError(['Sam']), null);
    assert.equal(companionsError([]), null);
    assert.match(companionsError(Array.from({ length: 11 }, (_, i) => `P${i}`)), /at most 10/);
    assert.match(companionsError(['x'.repeat(41)]), /40 characters/);
    assert.ok(parseCompanions(Array.from({ length: 11 }, (_, i) => `P${i}`)).error);
    assert.ok(parseCompanions(['x'.repeat(41)]).error);
    assert.ok(parseCompanions([' ']).error);
    assert.ok(parseCompanions('Sam').error);
});

test('the people who came along count the places shared, and the filter finds them', async () => {
    const { companionsOf, visitedWith } = await load('companions.js');
    const { matchesDetails, detailFilterActive, describeDetailFilter } = await load('details.js');
    const lisbon = { visits: [{ companions: ['Sam'] }, { companions: ['sam', 'Alex'] }] };
    const rome = { visits: [{ companions: ['Alex'] }, { companions: [] }] };
    const oslo = { visits: [{}] };
    assert.deepEqual(companionsOf([lisbon, rome, oslo, {}]), [{ name: 'Alex', places: 2 }, { name: 'Sam', places: 1 }]);
    assert.equal(visitedWith(lisbon, 'SAM'), true);
    assert.equal(visitedWith(rome, 'Sam'), false);
    assert.equal(visitedWith({}, 'Sam'), false);
    assert.equal(matchesDetails(rome, { companion: 'alex' }), true);
    assert.equal(matchesDetails(oslo, { companion: 'Alex' }), false);
    assert.equal(matchesDetails(oslo, { companion: 'all' }), true);
    assert.equal(detailFilterActive({ tag: 'all', rating: 'all', companion: 'Sam' }), true);
    assert.equal(detailFilterActive({ tag: 'all', rating: 'all', companion: 'all' }), false);
    assert.equal(describeDetailFilter({ companion: 'Sam', tag: 'food' }), 'with Sam · #food');
});

test('a visit form checks its companions and the files keep them', async () => {
    const { checkVisit } = await load('visits.js');
    const { buildCsv, buildJson, parseCsv, validatePlace } = await load('io.js');
    assert.deepEqual(checkVisit({ startDate: '2024-05-01', companions: 'Sam, Alex' }).visit.companions, ['Sam', 'Alex']);
    assert.deepEqual(checkVisit({ startDate: '2024-05-01' }).visit.companions, []);
    assert.ok(checkVisit({ startDate: '2024-05-01', companions: 'x'.repeat(41) }).error);

    const marker = {
        lat: 38.7, lng: -9.1, type: 'visited', name: 'Lisbon', category: 'City',
        visits: [{ startDate: '2024-05-01', endDate: '2024-05-03', companions: ['Sam', 'Alex'] }, { startDate: '2023-01-01' }]
    };
    const json = JSON.parse(buildJson([marker]));
    assert.deepEqual(json[0].visits.map(visit => visit.companions), [['Sam', 'Alex'], []]);
    assert.deepEqual(validatePlace(json[0]).visits[0].companions, ['Sam', 'Alex']);
    const [record] = parseCsv(buildCsv([marker]));
    assert.equal(record.visitCompanions, 'Sam; Alex');
    assert.deepEqual(validatePlace(record).visits[0].companions, ['Sam', 'Alex']);
});
