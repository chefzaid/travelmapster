'use strict';

// Travel history for visa forms (public/js/travel-history.js): stays abroad over the last years,
// their purpose, and the CSV.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const countryOf = marker => ({ id: marker.countryId });
let nextId = 1;
const place = (countryId, name, visits, extra = {}) => ({ id: nextId++, countryId, name, category: 'City', type: 'visited', ...extra,
    visits: visits.map(([startDate, endDate = '', more = {}]) => ({ id: nextId++, startDate, endDate, ongoing: false, ...more })) });

test('stays abroad of the last years, newest first, each with its purpose', async () => {
    const { buildLedger } = await load('days.js');
    const { travelHistory, buildHistoryCsv, HISTORY_FIELDS } = await load('travel-history.js');
    const markers = [
        place('FRA', 'Paris, France', [['2026-03-01', '2026-03-05']]),
        place('FRA', 'Lyon, France', [['2026-03-05', '2026-03-07', { purpose: 'business', organizationId: 1 }]]),
        place('DEU', 'Berlin, Germany', [['2020-01-01', '2021-06-30']], { stay: 'lived' }),
        place('ARE', 'Dubai, United Arab Emirates', [['2025-08-10', '2025-08-10']], { stay: 'transit' }),
        place('PRT', 'Lisbon, Portugal', [['2026-09-01', '2026-09-20']]),
        place('ITA', '=Rome, Italy', [['2012-05-01', '2012-05-03']])
    ];
    const ledger = buildLedger(markers, countryOf, { today: '2026-10-26', planned: [{ id: 'p', countryId: 'ESP', startDate: '2026-12-01', endDate: '2026-12-05' }] });
    const history = travelHistory(ledger, { homeId: 'PRT', years: 10, today: '2026-10-26' });
    assert.deepEqual(history.map(stay => [stay.countryId, stay.from, stay.to, stay.days, stay.purpose]), [
        ['FRA', '2026-03-01', '2026-03-07', 7, 'business'],
        ['ARE', '2025-08-10', '2025-08-10', 1, 'transit'],
        ['DEU', '2020-01-01', '2021-06-30', 547, 'residence']
    ], 'home country, planned stays and stays before the period are left out');
    assert.deepEqual(history[0].places, ['Paris', 'Lyon']);
    assert.equal(travelHistory(ledger, { homeId: 'PRT', years: 5, today: '2026-10-26' }).length, 2, 'five years end before Berlin');
    assert.equal(travelHistory(ledger, { years: 20, today: '2026-10-26' }).length, 5, 'without a home country, every stay');

    const csv = buildHistoryCsv(travelHistory(ledger, { years: 20, today: '2026-10-26' }), id => ({ ITA: 'Italy' })[id] || id).split('\r\n');
    assert.equal(csv[0], HISTORY_FIELDS.map(field => `"${field}"`).join(','));
    assert.equal(csv[1], '"PRT","2026-09-01","2026-09-20","20","Tourism or personal","Lisbon"');
    assert.equal(csv.at(-1), '"Italy","2012-05-01","2012-05-03","3","Tourism or personal","\'=Rome"', 'formula-like names are defused');
});
