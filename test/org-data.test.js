'use strict';

// Organizations in the browser (public/js/org-data.js, ledger-org.js): invitation links, a
// visit's purpose, the report's CSV and the business visits counted for an employer.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

test('an invitation link carries its token, pasted whole or alone', async () => {
    const { invitationLink, invitationToken } = await load('org-data.js');
    const link = invitationLink('https://travelmapster.example', TOKEN);
    assert.equal(link, `https://travelmapster.example/#join=${TOKEN}`);
    assert.equal(invitationToken(link), TOKEN);
    assert.equal(invitationToken(` ${TOKEN} `), TOKEN);
    assert.equal(invitationToken(`#join=${TOKEN}`), TOKEN);
    for (const bad of ['', null, 'short', `https://x/#join=${TOKEN}<script>`, `${TOKEN}!`]) assert.equal(invitationToken(bad), null, String(bad));
});

test('a visit\'s purpose round-trips through the form', async () => {
    const { purposeValue, readPurpose } = await load('org-data.js');
    assert.equal(purposeValue({ purpose: 'business', organizationId: 7 }), 'business:7');
    assert.equal(purposeValue({ purpose: 'personal', organizationId: null }), 'personal');
    assert.equal(purposeValue({ purpose: 'business', organizationId: null }), 'personal');
    assert.equal(purposeValue(undefined), 'personal');
    assert.deepEqual(readPurpose('business:7'), { purpose: 'business', organizationId: 7 });
    assert.deepEqual(readPurpose('personal'), { purpose: 'personal', organizationId: null });
    assert.deepEqual(readPurpose('business:x'), { purpose: 'personal', organizationId: null });
});

test('the report becomes CSV with a row per country and per rule, formulas defused', async () => {
    const { buildReportCsv, REPORT_FIELDS } = await load('org-data.js');
    const csv = buildReportCsv({
        members: [
            { username: 'ana', role: 'traveler', countries: [{ countryId: 'FRA', name: 'France', days: 10 }], rules: [{ name: '=France A1', kind: 'threshold', count: 10, maxDays: 8, status: 'reached' }] },
            { username: 'ben', role: 'admin', countries: [], rules: [] }
        ]
    }).split('\r\n');
    assert.equal(csv[0], REPORT_FIELDS.map(field => `"${field}"`).join(','));
    assert.deepEqual(csv.slice(1), [
        '"ana","traveler","country","France","10","",""',
        '"ana","traveler","threshold","\'=France A1","10","8","reached"'
    ]);
});

test('only the business visits for that organization count for it', async () => {
    const { businessMarkers } = await load('ledger-org.js');
    const markers = [
        { id: 1, visits: [{ id: 1, purpose: 'business', organizationId: 7 }, { id: 2, purpose: 'personal', organizationId: null }, { id: 3, purpose: 'business', organizationId: 8 }] },
        { id: 2, visits: [{ id: 4, purpose: 'personal', organizationId: null }] },
        { id: 3 }
    ];
    assert.deepEqual(businessMarkers(markers, 7), [{ id: 1, visits: [{ id: 1, purpose: 'business', organizationId: 7 }] }]);
    assert.equal(markers[0].visits.length, 3, 'the places are not changed');
});

test('a business trip lists its organization\'s tasks for its countries, due before it starts', async () => {
    const { tripChecklist, withChecklistItems } = await load('org-data.js');
    const orgs = [{ id: 7, name: 'Acme', checklist: [
        { id: 'a1', task: 'A1 certificate', countries: ['DEU', 'FRA'], daysBefore: 14, link: null },
        { id: 'visa', task: 'Visa', countries: ['CHN'], daysBefore: 30, link: null },
        { id: 'brief', task: 'Risk briefing', countries: ['DEU'], daysBefore: 0, link: 'https://example.com' }
    ] }];
    const trip = { organizationId: 7, startDate: '2027-06-15', packing: [{ item: 'a1 Certificate ', packed: true }, { item: 'Risk briefing', packed: false }] };
    const list = tripChecklist({ trip, orgs, countryIds: ['DEU'], today: '2027-06-10' });
    assert.equal(list.org.name, 'Acme');
    assert.deepEqual(list.items.map(({ item, state, due, overdue }) => [item.id, state, due, overdue]), [
        ['a1', 'done', '2027-06-01', false],
        ['brief', 'listed', '2027-06-15', false]
    ]);
    assert.equal(tripChecklist({ trip: { ...trip, packing: [] }, orgs, countryIds: ['DEU'], today: '2027-06-10' }).items[0].overdue, true);
    assert.equal(tripChecklist({ trip: { ...trip, startDate: '' }, orgs, countryIds: ['DEU'], today: '2027-06-10' }).items[0].due, null);
    assert.equal(tripChecklist({ trip, orgs, countryIds: ['ITA'], today: '2027-06-10' }), null, 'nothing asked for Italy');
    assert.equal(tripChecklist({ trip: { ...trip, organizationId: null }, orgs, countryIds: ['DEU'], today: '2027-06-10' }), null, 'a personal trip');
    assert.equal(tripChecklist({ trip: { ...trip, organizationId: 8 }, orgs, countryIds: ['DEU'], today: '2027-06-10' }), null, 'an organization left');

    const packing = withChecklistItems([{ item: 'Risk briefing', packed: true }], list.items);
    assert.deepEqual(packing, [{ item: 'Risk briefing', packed: true }, { item: 'A1 certificate', packed: false }]);
    assert.equal(withChecklistItems(Array.from({ length: 200 }, (_, i) => ({ item: `x${i}`, packed: false })), list.items).length, 200);
});

test('a checklist item is checked the way the API checks it', async () => {
    const { checkChecklistItem } = await load('org-data.js');
    assert.deepEqual(checkChecklistItem({ id: 'a', task: ' A1 ', daysBefore: '7', link: '' }, ['DEU']).item,
        { id: 'a', task: 'A1', countries: ['DEU'], daysBefore: 7, link: null });
    assert.equal(checkChecklistItem({ id: 'a', task: 'A1', daysBefore: '' }, ['DEU']).item.daysBefore, 0);
    assert.match(checkChecklistItem({ task: '' }, ['DEU']).error, /task/);
    assert.match(checkChecklistItem({ task: 'A1' }, []).error, /country/);
    assert.match(checkChecklistItem({ task: 'A1', daysBefore: '400' }, ['DEU']).error, /365/);
    assert.match(checkChecklistItem({ task: 'A1', daysBefore: '1.5' }, ['DEU']).error, /whole/);
    assert.match(checkChecklistItem({ task: 'A1', link: 'javascript:alert(1)' }, ['DEU']).error, /link/);
});
