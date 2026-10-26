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
