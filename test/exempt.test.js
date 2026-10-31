'use strict';

// Days that do not count (public/js/days.js stayDays, ledger-rules.js checkExemption): days in a
// country under a residence permit or long-stay visa leave its stay rules, never its thresholds.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const countryOf = marker => ({ id: marker.countryId });
const place = (id, countryId, startDate, endDate) => ({ id, countryId, name: `Place ${id}`, category: 'City', type: 'visited',
    visits: [{ id: id * 10, startDate, endDate }] });
const markers = [place(1, 'FRA', '2026-01-01', '2026-03-31'), place(2, 'DEU', '2026-03-31', '2026-04-09')];
const permit = { id: 'e1', label: 'French residence permit', countries: ['FRA'], startDate: '2026-01-01', endDate: '2026-12-31' };

test('stay rules leave out the days a permit covers, in its countries only', async () => {
    const { buildLedger, stayDays, daysIn, SCHENGEN_AREA } = await load('days.js');
    const ledger = buildLedger(markers, countryOf, { today: '2026-04-10' });
    assert.equal(daysIn(ledger, SCHENGEN_AREA).length, 99);
    assert.equal(stayDays(ledger, SCHENGEN_AREA).length, 99, 'nothing exempt by default');
    // 31 March is in France and Germany: Germany still counts it.
    assert.equal(stayDays(ledger, SCHENGEN_AREA, [permit]).length, 10);
    assert.equal(stayDays(ledger, SCHENGEN_AREA, [{ ...permit, startDate: '2026-03-01' }]).length, 69, 'only within the period');
});

test('the overview counts Schengen without the permit\'s days, and the 183-day threshold with them', async () => {
    const { ledgerOverview } = await load('days.js');
    const settings = { dayRule: 'presence', rules: [], planned: [], exempt: [permit] };
    const overview = ledgerOverview({ markers, countryOf, settings, today: '2026-04-10' });
    const schengen = overview.stays.find(item => item.rule.id === 'schengen');
    assert.equal(schengen.used, 10);
    assert.equal(overview.thresholds.find(item => item.countries[0] === 'FRA').count, 90);
    const without = ledgerOverview({ markers, countryOf, settings: { ...settings, exempt: [] }, today: '2026-04-10' });
    assert.equal(without.stays.find(item => item.rule.id === 'schengen').recentBreach !== null, true, '99 days break 90/180');
});

test('a period is checked as the API checks it', async () => {
    const { checkExemption } = await load('ledger-rules.js');
    const { useCatalog } = await load('i18n.js');
    useCatalog('en');
    assert.deepEqual(checkExemption({ ...permit, label: ' Permit ' }, ['FRA']).period, { ...permit, label: 'Permit' });
    assert.match(checkExemption({ ...permit, label: '' }, ['FRA']).error, /Name the permit/);
    assert.match(checkExemption(permit, []).error, /at least one country/);
    assert.match(checkExemption({ ...permit, endDate: '2025-12-31' }, ['FRA']).error, /end on or after/);
    assert.match(checkExemption({ ...permit, startDate: '' }, ['FRA']).error, /first and last day/);
});
