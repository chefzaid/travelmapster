'use strict';

// The employer's report (ADR 0029): periods and counts from business visits alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { orgReport, parsePeriod, yearOf } = require('../../src/org-report');

test('a report period is two real dates in order, at most ten years apart', () => {
    assert.deepEqual(parsePeriod('2026-01-01', '2026-12-31'), { from: '2026-01-01', to: '2026-12-31' });
    assert.deepEqual(parsePeriod('2026-03-01', '2026-03-01'), { from: '2026-03-01', to: '2026-03-01' });
    for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-03-02', '2026-03-01'], ['2010-01-01', '2026-01-01'], ['2026-1-1', '2026-02-01'], [undefined, '2026-01-01']]) {
        assert.equal(parsePeriod(from, to), null, `${from}..${to}`);
    }
    assert.deepEqual(yearOf(new Date('2027-06-15T12:00:00Z')), { from: '2027-01-01', to: '2027-12-31' });
});

test('each member gets business days per country and the status of every employer rule', async () => {
    const members = [{ id: 1, username: 'ana', role: 'traveler' }, { id: 2, username: 'ben', role: 'admin' }];
    const visits = [
        { userId: 1, markerId: 10, lat: 48.8566, lng: 2.3522, category: 'visited', name: 'Paris', id: 100, startDate: '2026-03-01', endDate: '2026-03-05', ongoing: false },
        { userId: 1, markerId: 10, lat: 48.8566, lng: 2.3522, category: 'visited', name: 'Paris', id: 101, startDate: '2026-05-01', endDate: '2026-05-02', ongoing: false },
        { userId: 1, markerId: 11, lat: 35.6762, lng: 139.6503, category: 'visited', name: 'Tokyo', id: 102, startDate: '2026-04-10', endDate: '', ongoing: true }
    ];
    const rules = [{ id: 'fr', kind: 'threshold', name: 'France', countries: ['FRA'], maxDays: 7, period: 'calendar-year', windowDays: 365, warnDays: 1 }];
    const [ana, ben] = await orgReport({ members, visits, rules, from: '2026-01-01', to: '2026-04-12', today: '2026-06-01' });
    assert.deepEqual(ana.countries, [{ countryId: 'FRA', name: 'France', days: 5 }, { countryId: 'JPN', name: 'Japan', days: 3 }], 'the ongoing stay counts up to the period end');
    assert.deepEqual(ana.rules, [{ ruleId: 'fr', name: 'France', kind: 'threshold', status: 'reached', count: 7, maxDays: 7, reachDate: '2026-05-02', forecast: null }]);
    assert.deepEqual([ana.plannedTrips, ana.unknownTrips], [0, 0]);
    assert.equal(JSON.stringify(ana).includes('Paris'), false, 'no place names');
    assert.deepEqual([ben.countries, ben.rules[0].status, ben.rules[0].count], [[], 'ok', 0]);
});

test('business trips planned ahead forecast each rule, from today, without their places or dates', async () => {
    const members = [{ id: 1, username: 'ana', role: 'traveler' }];
    const visits = [{ userId: 1, markerId: 10, lat: 48.8566, lng: 2.3522, category: 'visited', name: 'Paris', id: 100, startDate: '2026-05-25', endDate: '2026-05-29', ongoing: false }];
    const day = () => ({ morning: '', afternoon: '', evening: '' });
    const trips = [
        // Under way: Lyon from 30 May to 3 June, of which 1–3 June are ahead.
        { userId: 1, id: 7, destination: 'Lyon, France', startDate: '2026-05-30', plan: Array.from({ length: 5 }, day), stops: [] },
        { userId: 1, id: 8, destination: 'Paris', startDate: '2026-06-20', plan: Array.from({ length: 10 }, day), stops: [] },
        { userId: 1, id: 9, destination: 'Xyzzyville', startDate: '2026-07-01', plan: [day()], stops: [] }
    ];
    const rules = [
        { id: 'fr', kind: 'threshold', name: 'France', countries: ['FRA'], maxDays: 15, period: 'year', yearStart: '01-01', windowDays: 365, warnDays: 1 },
        { id: 'stay', kind: 'stay', name: 'France 10/30', countries: ['FRA'], maxDays: 10, windowDays: 30, warnDays: 1, dayRule: 'presence' }
    ];
    const [ana] = await orgReport({ members, visits, trips, rules, from: '2026-01-01', to: '2026-12-31', today: '2026-06-01' });
    assert.deepEqual([ana.plannedTrips, ana.unknownTrips], [2, 1], 'a trip to no known place is left out and counted apart');
    const [stay] = ana.rules.filter(rule => rule.kind === 'stay');
    const [threshold] = ana.rules.filter(rule => rule.kind === 'threshold');
    assert.deepEqual(threshold.forecast, { count: 18, reached: true }, '5 days recorded, 3 left of Lyon and 10 in Paris');
    assert.equal(stay.forecast.fits, false);
    assert.equal(stay.forecast.firstBreach, '2026-06-22', 'the 11th day within 30 days: 5 recorded, 3 in Lyon, then the third in Paris');
    assert.equal(JSON.stringify(ana).includes('Lyon'), false, 'no destinations');
});
