'use strict';

// Rules and planned stays edited in the Ledger tab (public/js/ledger-rules.js), checked the way
// the API checks them.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

test('rules and planned stays are checked the way the API checks them', async () => {
    const { checkRule, checkPlannedStay, parseCountryList, newId } = await load('ledger-rules.js');
    const { SCHENGEN_AREA } = await load('days.js');
    const find = name => ({ france: { id: 'FRA' }, spain: { id: 'ESP' }, fra: { id: 'FRA' } })[name.toLowerCase()] || null;
    assert.deepEqual(parseCountryList('France, Spain; fra', find), { ids: ['FRA', 'ESP'], unknown: [] });
    assert.deepEqual(parseCountryList('Schengen area, Narnia', find).unknown, ['Narnia']);
    assert.equal(parseCountryList('schengen', find).ids.length, SCHENGEN_AREA.length);
    assert.deepEqual(parseCountryList('', find), { ids: [], unknown: [] });
    assert.deepEqual(parseCountryList('France، Spain؛ fra', find), { ids: ['FRA', 'ESP'], unknown: [] }, 'Arabic separators');
    for (const area of ['espace Schengen', 'Schengen-Raum', 'منطقة شنغن']) assert.equal(parseCountryList(area, find).ids.length, SCHENGEN_AREA.length, area);

    const stay = { id: 'a', kind: 'stay', name: ' Visa ', maxDays: '30', windowDays: '60', warnDays: '', dayRule: 'midnight' };
    assert.deepEqual(checkRule(stay, ['FRA']).rule, { id: 'a', kind: 'stay', name: 'Visa', countries: ['FRA'], maxDays: 30, windowDays: 60, warnDays: 0, dayRule: 'midnight' });
    assert.equal(checkRule({ ...stay, dayRule: 'noon' }, ['FRA']).rule.dayRule, 'presence');
    assert.match(checkRule({ ...stay, maxDays: '61' }, ['FRA']).error, /no more than the window/);
    assert.match(checkRule({ ...stay, windowDays: '0' }, ['FRA']).error, /window/);
    assert.match(checkRule({ ...stay, name: '' }, ['FRA']).error, /name/);
    assert.match(checkRule(stay, []).error, /country/);
    assert.match(checkRule(stay, Array(81).fill('FRA')).error, /80/);
    assert.match(checkRule({ ...stay, warnDays: '400' }, ['FRA']).error, /Warn/);

    const tax = { id: 'b', kind: 'threshold', name: 'UK', maxDays: '90', period: 'year', yearStart: '04-06', windowDays: '', warnDays: '20' };
    assert.deepEqual(checkRule(tax, ['GBR']).rule, { id: 'b', kind: 'threshold', name: 'UK', countries: ['GBR'], maxDays: 90, period: 'year', yearStart: '04-06', warnDays: 20 });
    assert.match(checkRule({ ...tax, yearStart: '02-29' }, ['GBR']).error, /MM-DD/);
    assert.match(checkRule({ ...tax, maxDays: '400' }, ['GBR']).error, /366/);
    assert.deepEqual(checkRule({ ...tax, period: 'rolling', windowDays: '365' }, ['GBR']).rule.windowDays, 365);
    assert.match(checkRule({ ...tax, period: 'rolling', windowDays: '9999' }, ['GBR']).error, /window/);
    assert.match(checkRule({ ...tax, period: 'rolling', windowDays: '30', maxDays: '31' }, ['GBR']).error, /no more than the window/);

    assert.deepEqual(checkPlannedStay({ id: 'p', countryId: 'FRA', startDate: '2026-11-01', endDate: '2026-11-02' }).stay,
        { id: 'p', countryId: 'FRA', startDate: '2026-11-01', endDate: '2026-11-02' });
    assert.match(checkPlannedStay({ countryId: '', startDate: '2026-11-01', endDate: '2026-11-02' }).error, /country/);
    assert.match(checkPlannedStay({ countryId: 'FRA', startDate: '2026-11-01' }).error, /first and last/);
    assert.match(checkPlannedStay({ countryId: 'FRA', startDate: '2026-11-02', endDate: '2026-11-01' }).error, /on or after/);
    assert.match(checkPlannedStay({ countryId: 'FRA', startDate: '2026-01-01', endDate: '2036-12-31' }).error, /3,660/);

    const id = newId(() => 0.5);
    assert.match(id, /^[a-z0-9]{8,}$/);
    assert.notEqual(newId(), newId(() => 0.123));
});
