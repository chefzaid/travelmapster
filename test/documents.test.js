'use strict';

// Travel documents (public/js/documents.js): validity, warnings before expiry, and the trips
// ahead they do not cover, with the same rules as the API (src/ledger-validation.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseLedgerSettings } = require('../src/validation');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'documents.js'));
const plan = n => Array.from({ length: n }, () => ({ morning: '', afternoon: '', evening: '' }));

test('months are added on the calendar, kept within shorter months', async () => {
    const { addMonths } = await load();
    assert.equal(addMonths('2027-01-15', 6), '2027-07-15');
    assert.equal(addMonths('2027-08-31', 6), '2028-02-29');
    assert.equal(addMonths('2027-10-31', 1), '2027-11-30');
    assert.equal(addMonths('2027-12-01', 1), '2028-01-01');
});

test('a document is valid, expiring within 90 days, expired or not valid yet', async () => {
    const { documentStatus } = await load();
    const passport = { validUntil: '2027-06-30' };
    assert.deepEqual(documentStatus(passport, '2027-01-01'), { state: 'valid', days: 180 });
    assert.deepEqual(documentStatus(passport, '2027-04-01'), { state: 'expiring', days: 90 });
    assert.deepEqual(documentStatus(passport, '2027-06-30'), { state: 'expiring', days: 0 });
    assert.deepEqual(documentStatus(passport, '2027-07-01'), { state: 'expired' });
    assert.deepEqual(documentStatus({ validFrom: '2027-02-01', validUntil: '2028-01-01' }, '2027-01-01'), { state: 'not_yet' });
});

test('trips ahead are checked against the six months a passport should last, and a visa\'s days', async () => {
    const { tripDocumentWarnings } = await load();
    const trip = { title: 'Tokyo', startDate: '2027-05-01', plan: plan(10) };
    const countriesOf = () => ['JPN'];
    const passport = valid => ({ id: 'p', kind: 'passport', label: 'Passport', validUntil: valid });
    const reasons = (documents, today = '2027-01-01', trips = [trip]) => tripDocumentWarnings(trips, documents, today, countriesOf).map(item => item.reason);
    assert.deepEqual(reasons([passport('2027-05-05')]), ['expires_during']);
    assert.deepEqual(reasons([passport('2027-11-09')]), ['six_months']);
    assert.deepEqual(reasons([passport('2027-11-10')]), [], 'six months after the last day is enough');
    const visa = { id: 'v', kind: 'visa', label: 'Visa', country: 'JPN', validFrom: '2027-05-02', validUntil: '2027-12-01' };
    assert.deepEqual(reasons([visa]), ['visa_gap']);
    assert.deepEqual(reasons([{ ...visa, validFrom: null }]), []);
    assert.deepEqual(reasons([{ ...visa, validFrom: null, validUntil: '2027-05-09' }]), ['visa_gap']);
    assert.deepEqual(reasons([{ ...visa, country: 'USA', validUntil: '2027-01-02' }]), [], 'a visa for another country');
    assert.deepEqual(reasons([{ id: 'i', kind: 'id_card', label: 'ID', validUntil: '2027-05-02' }]), []);
    // Trips without dates or already over are left alone.
    assert.deepEqual(reasons([passport('2027-05-05')], '2027-06-01'), []);
    assert.deepEqual(reasons([passport('2027-05-05')], '2027-01-01', [{ ...trip, startDate: '' }]), []);
});

test('the form checks a document as the API does', async () => {
    const { checkDocument, documentKind } = await load();
    const values = { id: 'd1', kind: 'passport', label: ' My passport ', validFrom: '', validUntil: '2030-01-01' };
    const { document } = checkDocument(values, 'PRT');
    assert.deepEqual(document, { id: 'd1', kind: 'passport', label: 'My passport', country: 'PRT', validFrom: null, validUntil: '2030-01-01' });
    assert.deepEqual(parseLedgerSettings({ dayRule: 'presence', documents: [document] }).settings.documents, [document]);
    assert.ok(checkDocument({ ...values, kind: 'ticket' }).error);
    assert.ok(checkDocument({ ...values, label: '' }).error);
    assert.ok(checkDocument({ ...values, validUntil: '' }).error);
    assert.ok(checkDocument({ ...values, validFrom: '2030-02-30' }).error);
    assert.ok(checkDocument({ ...values, validFrom: '2031-01-01' }).error);
    assert.equal(checkDocument(values).document.country, null);
    assert.equal(documentKind('visa').icon, '📄');
    assert.equal(documentKind('unknown').id, 'other');
});
