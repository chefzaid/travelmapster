// Unit and property tests for the day ledger (public/js/days.js and ledger-evidence.js):
// counting rules, Schengen 90/180 cases in the style of the European Commission's short-stay
// calculator, thresholds, plans and evidence. Property tests use a seeded generator, so failures reproduce.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'days.js'));
const loadEvidence = () => import(path.join(__dirname, '..', 'public', 'js', 'ledger-evidence.js'));

// Small, fast, seeded PRNG (mulberry32).
function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const between = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));

// Brute-force calendar arithmetic with Date objects, independent of the module.
function datesFrom(start, end) {
    const dates = [];
    for (const date = new Date(`${start}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
        dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
}
const shift = (iso, days) => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

const COUNTRIES = { FRA: 'France', ESP: 'Spain', PRT: 'Portugal', IRL: 'Ireland', CYP: 'Cyprus', AND: 'Andorra', MCO: 'Monaco', ROU: 'Romania', BGR: 'Bulgaria', GBR: 'United Kingdom', USA: 'United States' };
const countryOf = marker => (marker.countryId ? { id: marker.countryId } : null);
let nextId = 1;
const place = (countryId, visits, extra = {}) => ({
    id: nextId++, countryId, name: COUNTRIES[countryId] || countryId, category: 'Country',
    visits: visits.map(([startDate, endDate = '', ongoing = false]) => ({ id: nextId++, startDate, endDate, ongoing })),
    ...extra
});

test('calendar dates map to day numbers without time-zone shifts, across leap years', async () => {
    const { dayNumber, isoDay, addDays, localToday } = await load();
    assert.equal(dayNumber('1970-01-01'), 0);
    assert.equal(dayNumber('2024-03-01') - dayNumber('2024-02-28'), 2, '2024 is a leap year');
    assert.equal(dayNumber('2023-03-01') - dayNumber('2023-02-28'), 1);
    assert.equal(dayNumber('2100-03-01') - dayNumber('2100-02-28'), 1, '2100 is not a leap year');
    assert.equal(dayNumber('2000-03-01') - dayNumber('2000-02-28'), 2, '2000 is a leap year');
    assert.equal(addDays('2024-12-31', 1), '2025-01-01');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29');
    assert.equal(localToday(new Date(2026, 0, 5, 23, 59)), '2026-01-05', 'today is the device\'s local date');

    const rand = random(1);
    for (let i = 0; i < 2000; i += 1) {
        const iso = `${between(rand, 1900, 2100)}-${String(between(rand, 1, 12)).padStart(2, '0')}-${String(between(rand, 1, 28)).padStart(2, '0')}`;
        assert.equal(isoDay(dayNumber(iso)), iso);
        const offset = between(rand, -800, 800);
        assert.equal(addDays(iso, offset), shift(iso, offset));
    }
});

test('a visit counts its days by the chosen rule, and open-ended stays explicitly', async () => {
    const { visitSpan, dayNumber, isoDay } = await load();
    const today = '2026-10-23';
    const span = (visit, dayRule) => {
        const result = visitSpan(visit, { dayRule, today });
        return result && [isoDay(result.first), isoDay(result.last), result.open];
    };
    // Any part of a day: arrival and departure days both count.
    assert.deepEqual(span({ startDate: '2026-05-01', endDate: '2026-05-04' }, 'presence'), ['2026-05-01', '2026-05-04', null]);
    // Midnight rule: the nights; the departure day counts elsewhere.
    assert.deepEqual(span({ startDate: '2026-05-01', endDate: '2026-05-04' }, 'midnight'), ['2026-05-01', '2026-05-03', null]);
    assert.equal(span({ startDate: '2026-05-01', endDate: '2026-05-01' }, 'midnight'), null, 'a day trip spends no night');
    assert.deepEqual(span({ startDate: '2026-05-01', endDate: '2026-05-01' }, 'presence'), ['2026-05-01', '2026-05-01', null]);
    // Leap day inside a stay.
    const leap = visitSpan({ startDate: '2024-02-28', endDate: '2024-03-01' }, { today });
    assert.equal(leap.last - leap.first + 1, 3);

    // End not recorded: the first day only, under either rule, and flagged.
    for (const rule of ['presence', 'midnight']) {
        assert.deepEqual(span({ startDate: '2015-06-01' }, rule), ['2015-06-01', '2015-06-01', 'unrecorded']);
        assert.deepEqual(span({ startDate: '2026-10-01', ongoing: true }, rule), ['2026-10-01', today, 'ongoing'], 'still there: through today');
    }
    assert.deepEqual(span({ startDate: '2026-12-01', ongoing: true }), ['2026-12-01', '2026-12-01', 'ongoing'], 'a later start counts its first day');
    assert.deepEqual(span({ startDate: '2026-05-01', endDate: '2026-05-03', ongoing: true }), ['2026-05-01', '2026-05-03', null], 'an end date wins');

    // The ledger covers 1900 to ten years ahead.
    assert.deepEqual(span({ startDate: '1899-12-30', endDate: '1900-01-02' }), ['1900-01-01', '1900-01-02', null]);
    const far = visitSpan({ startDate: '2026-01-01', endDate: '9999-12-31' }, { today });
    assert.equal(far.last, dayNumber(today) + 3660);
});

test('city visits count for their country, once per day', async () => {
    const { buildLedger, daysIn, dayNumber } = await load();
    const markers = [
        place('PRT', [['2024-06-01', '2024-06-03']]),
        place('PRT', [['2024-06-03', '2024-06-05']], { name: 'Porto, Portugal', category: 'City' }),
        place('PRT', [['2024-06-04', '2024-06-04']], { name: 'Lisbon, Portugal', category: 'City' }),
        place(null, [['2024-01-01', '2024-01-02']], { name: 'Atlantis' }),
        place('ESP', [], { name: 'Spain, no dates' })
    ];
    const ledger = buildLedger(markers, countryOf, { today: '2026-10-23' });
    assert.deepEqual(daysIn(ledger, ['PRT']), [0, 1, 2, 3, 4].map(offset => dayNumber('2024-06-01') + offset));
    assert.equal(ledger.countries.get('PRT').get(dayNumber('2024-06-03')).length, 2, 'both visits are sources of the day');
    assert.equal(ledger.unplaced.length, 1);
    assert.equal(ledger.countries.has('ESP'), false);
});

test('property: country days match a brute-force count for random visits under both rules', async () => {
    const { buildLedger, daysIn, isoDay } = await load();
    const rand = random(42);
    const today = '2026-10-23';
    for (let round = 0; round < 150; round += 1) {
        const markers = [];
        for (let i = 0; i < between(rand, 1, 8); i += 1) {
            const visits = [];
            for (let v = 0; v < between(rand, 1, 4); v += 1) {
                const start = shift('2023-01-01', between(rand, 0, 1500));
                const kind = rand();
                if (kind < 0.7) visits.push([start, shift(start, between(rand, 0, 40))]);
                else if (kind < 0.85) visits.push([start]);
                else visits.push([start, '', true]);
            }
            markers.push(place(pick(rand, ['FRA', 'ESP', 'PRT']), visits));
        }
        for (const dayRule of ['presence', 'midnight']) {
            const expected = { FRA: new Set(), ESP: new Set(), PRT: new Set() };
            for (const marker of markers) {
                for (const visit of marker.visits) {
                    let dates;
                    if (visit.endDate) dates = datesFrom(visit.startDate, dayRule === 'midnight' ? shift(visit.endDate, -1) : visit.endDate);
                    else if (visit.ongoing) dates = datesFrom(visit.startDate, visit.startDate > today ? visit.startDate : today);
                    else dates = [visit.startDate];
                    dates.forEach(date => expected[marker.countryId].add(date));
                }
            }
            const ledger = buildLedger(markers, countryOf, { dayRule, today });
            for (const id of Object.keys(expected)) {
                assert.deepEqual(daysIn(ledger, [id]).map(isoDay), [...expected[id]].sort(), `round ${round}, ${dayRule}, ${id}`);
            }
        }
    }
});

test('property: on a journey through several countries the midnight rule counts each night once', async () => {
    const { buildLedger, daysIn } = await load();
    const rand = random(7);
    for (let round = 0; round < 200; round += 1) {
        // Each leg starts on the day the previous one ends: an overnight border crossing.
        const legs = [];
        let date = shift('2024-01-01', between(rand, 0, 700));
        const first = date;
        let previous = null;
        for (let i = 0; i < between(rand, 1, 6); i += 1) {
            const country = pick(rand, ['FRA', 'ESP', 'PRT', 'IRL'].filter(id => id !== previous));
            const end = shift(date, between(rand, 0, 20));
            legs.push(place(country, [[date, end]]));
            previous = country;
            date = end;
        }
        const nights = datesFrom(first, date).length - 1;
        const midnight = buildLedger(legs, countryOf, { dayRule: 'midnight', today: '2026-10-23' });
        const perCountry = ['FRA', 'ESP', 'PRT', 'IRL'].reduce((sum, id) => sum + daysIn(midnight, [id]).length, 0);
        // A same-day leg spends no night, and countries can repeat, so compare the union.
        assert.equal(daysIn(midnight).length, nights, `round ${round}: one country per night`);
        assert.ok(perCountry >= daysIn(midnight).length);

        const presence = buildLedger(legs, countryOf, { today: '2026-10-23' });
        assert.equal(daysIn(presence).length, nights + 1, 'any part of a day covers every calendar day');
        const crossings = legs.length - 1;
        const total = ['FRA', 'ESP', 'PRT', 'IRL'].reduce((sum, id) => sum + daysIn(presence, [id]).length, 0);
        assert.ok(total <= nights + 1 + crossings, 'a crossing day counts in both countries at most');
    }
});

test('property: windows and breaches match a brute-force count', async () => {
    const { usedOn, breaches, countBetween } = await load();
    const rand = random(99);
    for (let round = 0; round < 200; round += 1) {
        const set = new Set();
        for (let i = 0; i < between(rand, 0, 200); i += 1) set.add(between(rand, 0, 600));
        const days = [...set].sort((a, b) => a - b);
        const windowDays = between(rand, 1, 200);
        const maxDays = between(rand, 1, windowDays);
        const brute = day => days.filter(item => item > day - windowDays && item <= day).length;
        for (let k = 0; k < 20; k += 1) {
            const day = between(rand, -10, 650);
            assert.equal(usedOn(days, day, windowDays), brute(day));
            const to = day + between(rand, -5, 100);
            assert.equal(countBetween(days, day, to), days.filter(item => item >= day && item <= to).length);
        }
        assert.deepEqual(breaches(days, { maxDays, windowDays }), days.filter(day => brute(day) > maxDays));
    }
});

test('property: the longest allowed stay is exactly the longest that breaks nothing new', async () => {
    const { maxStayFrom, breaches } = await load();
    const rand = random(2026);
    const newBreaches = (days, rule, entry, length) => {
        const withStay = [...new Set([...days, ...Array.from({ length }, (_, i) => entry + i)])].sort((a, b) => a - b);
        const before = breaches(days, rule).filter(day => day >= entry).length;
        return breaches(withStay, rule).filter(day => day >= entry).length - before;
    };
    for (let round = 0; round < 120; round += 1) {
        const set = new Set();
        let day = between(rand, 0, 50);
        while (day < 500) {
            const length = between(rand, 1, 40);
            for (let i = 0; i < length; i += 1) set.add(day + i);
            day += length + between(rand, 1, 120);
        }
        const days = [...set].sort((a, b) => a - b);
        const rule = pick(rand, [{ maxDays: 90, windowDays: 180 }, { maxDays: 30, windowDays: 60 }, { maxDays: 10, windowDays: 30 }]);
        const entry = between(rand, 0, 600);
        const { days: length, lastDay } = maxStayFrom(days, rule, entry);
        assert.ok(length >= 0 && length <= rule.maxDays);
        assert.equal(lastDay, length ? entry + length - 1 : null);
        assert.equal(newBreaches(days, rule, entry, length), 0, `round ${round}: the allowed stay breaks nothing`);
        if (length < rule.maxDays) assert.ok(newBreaches(days, rule, entry, length + 1) > 0, `round ${round}: one more day would`);
    }
});

test('Schengen membership is right for 2026', async () => {
    const { SCHENGEN_AREA, SCHENGEN_MEMBERS, SCHENGEN_RULE } = await load();
    assert.equal(SCHENGEN_MEMBERS.length, 29);
    for (const id of ['BGR', 'ROU', 'HRV', 'CHE', 'LIE', 'NOR', 'ISL']) assert.ok(SCHENGEN_MEMBERS.includes(id), id);
    for (const id of ['CYP', 'IRL', 'AND', 'GBR']) assert.ok(!SCHENGEN_AREA.includes(id), id);
    for (const id of ['MCO', 'SMR', 'VAT']) assert.ok(SCHENGEN_AREA.includes(id) && !SCHENGEN_MEMBERS.includes(id), `${id} by open borders`);
    assert.deepEqual([SCHENGEN_RULE.maxDays, SCHENGEN_RULE.windowDays, SCHENGEN_RULE.dayRule], [90, 180, 'presence']);
});

test('Schengen 90/180 calculator cases', async () => {
    const { buildLedger, daysIn, stayStatus, maxStayFrom, dayNumber, isoDay, SCHENGEN_RULE } = await load();
    const schengenDays = (markers, today) => daysIn(buildLedger(markers, countryOf, { today }), SCHENGEN_RULE.countries);
    const statusOn = (markers, today) => stayStatus(schengenDays(markers, today), SCHENGEN_RULE, today);
    const stayFrom = (markers, entry) => {
        const result = maxStayFrom(schengenDays(markers, entry), SCHENGEN_RULE, dayNumber(entry));
        return [result.days, result.lastDay === null ? null : isoDay(result.lastDay)];
    };

    // 1. Ninety days from 1 January to 31 March 2025 uses the whole allowance.
    const full = [place('FRA', [['2025-01-01', '2025-03-31']])];
    assert.deepEqual([statusOn(full, '2025-03-31').used, statusOn(full, '2025-03-31').remaining], [90, 0]);
    assert.deepEqual(statusOn(full, '2025-03-31').breaches, []);
    // Re-entry: the window of 29 June still holds all 90 days; on 30 June one has dropped out,
    // and a stay from then on can last 90 days as old days keep dropping out.
    assert.deepEqual(stayFrom(full, '2025-06-29'), [0, null]);
    assert.deepEqual(stayFrom(full, '2025-06-30'), [90, '2025-09-27']);
    assert.equal(statusOn(full, '2025-09-27').used, 0, 'the stay is long gone from the window');

    // 2. One more day is an overstay on that day.
    const over = [place('ESP', [['2025-01-01', '2025-04-01']])];
    assert.deepEqual(statusOn(over, '2025-04-01').breaches.map(isoDay), ['2025-04-01']);
    assert.equal(isoDay(statusOn(over, '2025-04-01').recentBreach), '2025-04-01');

    // 3. A leap year: 1 January to 30 March 2024 is 90 days.
    const leap = [place('ITA', [['2024-01-01', '2024-03-30']])];
    assert.deepEqual([statusOn(leap, '2024-03-30').used, statusOn(leap, '2024-03-30').breaches.length], [90, 0]);
    assert.equal(statusOn([place('ITA', [['2024-01-01', '2024-03-31']])], '2024-03-31').breaches.length, 1);

    // 4. Two stays in different countries add up; days outside the window do not.
    const trips = [place('DEU', [['2025-02-01', '2025-03-02']]), place('PRT', [['2025-05-01', '2025-05-30']])];
    assert.deepEqual([statusOn(trips, '2025-06-15').used, statusOn(trips, '2025-06-15').remaining], [60, 30]);
    assert.equal(statusOn(trips, '2025-08-15').used, 44, 'mid-August still holds the end of February');
    assert.equal(statusOn(trips, '2025-09-15').used, 30, 'February has left the window by mid-September');
    assert.deepEqual(stayFrom(trips, '2025-06-15'), [30, '2025-07-14']);

    // 5. Arrival and departure days count, even a single day, and an overnight crossing
    //    between two Schengen countries counts once.
    assert.equal(statusOn([place('AUT', [['2025-07-01', '2025-07-01']])], '2025-07-10').used, 1);
    const crossing = [place('FRA', [['2025-07-01', '2025-07-05']]), place('ESP', [['2025-07-05', '2025-07-09']])];
    assert.equal(statusOn(crossing, '2025-07-10').used, 9);

    // 6. Bulgaria, Romania and Monaco count; Ireland, Cyprus and Andorra do not.
    const mixed = [
        place('BGR', [['2025-03-01', '2025-03-10']]), place('ROU', [['2025-03-11', '2025-03-20']]), place('MCO', [['2025-03-21', '2025-03-21']]),
        place('IRL', [['2025-04-01', '2025-04-30']]), place('CYP', [['2025-05-01', '2025-05-30']]), place('AND', [['2025-06-01', '2025-06-10']])
    ];
    assert.equal(statusOn(mixed, '2025-06-30').used, 21);

    // 7. A stay still going on counts through today, so the days left shrink every day.
    const living = [place('PRT', [['2026-10-14', '', true]])];
    const now = statusOn(living, '2026-10-23');
    assert.deepEqual([now.used, now.remaining, now.inside], [10, 80, true]);
    // Today is already counted: 80 more days after it, so the stay can last until 11 January.
    assert.deepEqual([now.stay.days, isoDay(now.stay.lastDay)], [81, '2027-01-11']);
    // An end that was not recorded counts the first day only.
    assert.equal(statusOn([place('PRT', [['2026-10-14']])], '2026-10-23').used, 1);
});

test('periods run by calendar year, a tax year with its own start, or a rolling window', async () => {
    const { periodOf, dayNumber, isoDay } = await load();
    const period = (rule, iso) => {
        const result = periodOf(rule, dayNumber(iso));
        return [isoDay(result.from), isoDay(result.to)];
    };
    assert.deepEqual(period({ period: 'year', yearStart: '01-01' }, '2024-07-01'), ['2024-01-01', '2024-12-31']);
    assert.deepEqual(period({ period: 'year', yearStart: '04-06' }, '2026-04-05'), ['2025-04-06', '2026-04-05']);
    assert.deepEqual(period({ period: 'year', yearStart: '04-06' }, '2026-04-06'), ['2026-04-06', '2027-04-05']);
    assert.deepEqual(period({ period: 'year' }, '2024-12-31'), ['2024-01-01', '2024-12-31']);
    assert.deepEqual(period({ period: 'rolling', windowDays: 365 }, '2024-12-31'), ['2024-01-02', '2024-12-31'], '2024 has 366 days');
});

test('thresholds warn before they are reached and project stays still going on', async () => {
    const { buildLedger, thresholdStatus, TAX_RESIDENCY_RULE } = await load();
    const status = (markers, today, rule = TAX_RESIDENCY_RULE, dayRule = 'presence', ids = ['ESP']) =>
        thresholdStatus(buildLedger(markers, countryOf, { dayRule, today }), rule, ids, today);

    // 150 days in Spain by 30 May 2026: within 30 days of 183, so a warning.
    const spring = [place('ESP', [['2026-01-01', '2026-05-30']])];
    const warned = status(spring, '2026-10-23');
    assert.deepEqual([warned.count, warned.remaining, warned.status, warned.reachDate], [150, 33, 'ok', null]);
    const closer = status([place('ESP', [['2026-01-01', '2026-06-05']])], '2026-10-23');
    assert.deepEqual([closer.count, closer.status], [156, 'warning']);
    assert.deepEqual(closer.period, { from: '2026-01-01', to: '2026-12-31' });

    // Reached: the day it happened is the 183rd day.
    const reached = status([place('ESP', [['2026-01-01', '2026-07-31']])], '2026-10-23');
    assert.deepEqual([reached.count, reached.status, reached.reachDate], [212, 'reached', '2026-07-02']);
    // The midnight rule counts one day fewer per stay.
    assert.equal(status([place('ESP', [['2026-01-01', '2026-07-02']])], '2026-10-23', TAX_RESIDENCY_RULE, 'midnight').count, 182);

    // Still there since 1 July: 115 days by 23 October; 183 would come on 30 December.
    const living = status([place('ESP', [['2026-07-01', '', true]])], '2026-10-23');
    assert.deepEqual([living.count, living.stillThere, living.reachDate, living.status], [115, true, '2026-12-30', 'warning']);
    // Arriving in mid-November and staying on never reaches 183 this calendar year.
    assert.equal(status([place('ESP', [['2026-11-15', '', true]])], '2026-11-20').reachDate, null);
    // A recorded future stay that will cross the line warns too.
    assert.equal(status([place('ESP', [['2026-03-01', '2026-03-31'], ['2026-11-01', '2026-12-31']])], '2026-10-23', { ...TAX_RESIDENCY_RULE, maxDays: 60 }).status, 'warning');

    // A rolling threshold over two countries counted together.
    const rolling = { kind: 'threshold', period: 'rolling', windowDays: 365, maxDays: 100, warnDays: 0 };
    const pair = [place('ESP', [['2026-01-01', '2026-02-19']]), place('PRT', [['2026-02-20', '2026-04-10']])];
    const together = status(pair, '2026-10-23', rolling, 'presence', ['ESP', 'PRT']);
    assert.deepEqual([together.count, together.status, together.reachDate], [100, 'reached', '2026-10-23']);
    assert.equal(status([place('ESP', [['2026-10-01', '', true]])], '2026-10-23', rolling).reachDate, '2027-01-08');
});

test('counters, timeline, plans and alerts come together in the overview', async () => {
    const { ledgerOverview, countryCounters, buildLedger, SCHENGEN_RULE } = await load();
    const markers = [
        place('PRT', [['2026-01-10', '2026-01-20']]),
        place('PRT', [['2026-01-15', '2026-01-25']], { name: 'Porto, Portugal', category: 'City' }),
        place('FRA', [['2026-06-01', '2026-07-24']]),
        place('ESP', [['2026-04-01', '', true], ['2015-05-05']]),
        place('USA', [['2025-12-20', '2026-01-05']])
    ];
    const settings = {
        dayRule: 'presence',
        rules: [
            { id: 'r1', kind: 'stay', name: 'Iberia 30/60', countries: ['ESP', 'PRT'], maxDays: 30, windowDays: 60, warnDays: 5, dayRule: 'presence' },
            { id: 'r2', kind: 'threshold', name: 'Portugal NHR', countries: ['PRT'], maxDays: 20, period: 'year', yearStart: '01-01', warnDays: 5 }
        ],
        planned: [{ id: 'p1', countryId: 'FRA', startDate: '2026-11-01', endDate: '2026-11-20' }]
    };
    const today = '2026-10-23';
    const overview = ledgerOverview({ markers, countryOf, settings, today, nameOf: id => COUNTRIES[id] });

    assert.deepEqual(overview.stays.map(item => item.rule.id), ['schengen', 'r1']);
    const [schengen, iberia] = overview.stays;
    assert.deepEqual([schengen.used, schengen.remaining], [180, 0], 'every day since late April is in Spain');
    assert.equal(schengen.inside, true, 'still in Spain');
    assert.ok(iberia.recentBreach !== null, 'Spain since April breaks 30/60');

    // 183 per country this year, plus the traveler's own threshold.
    const byCountry = Object.fromEntries(overview.thresholds.filter(item => item.rule.builtIn).map(item => [item.countries[0], item]));
    assert.deepEqual(Object.keys(byCountry).sort(), ['ESP', 'FRA', 'PRT', 'USA']);
    assert.equal(byCountry.USA.count, 5, 'only this year\'s days count');
    assert.equal(byCountry.ESP.count, 206);
    assert.equal(byCountry.ESP.status, 'reached');
    const nhr = overview.thresholds.find(item => item.rule.id === 'r2');
    assert.deepEqual([nhr.count, nhr.status], [16, 'warning']);

    const messages = overview.alerts.map(alert => alert.message).join('\n');
    assert.match(messages, /Spain: 183 days reached/);
    assert.match(messages, /Iberia 30\/60: over the limit/);
    assert.match(messages, /Portugal NHR: 4 days to go/);
    assert.match(messages, /Schengen 90\/180/);

    // Timeline: Lisbon and Porto merge into one Portuguese stay.
    const portugal = overview.timeline.find(stay => stay.countryId === 'PRT');
    assert.deepEqual([portugal.from, portugal.to, portugal.days, portugal.sources.length], ['2026-01-10', '2026-01-25', 16, 2]);
    assert.equal(overview.timeline[0].countryId, 'ESP', 'newest first');
    assert.equal(overview.timeline[0].ongoing, true);
    assert.ok(overview.timeline.some(stay => stay.unrecorded && stay.from === '2015-05-05'));
    assert.equal(overview.unrecorded, 1);

    // Plans: November in France breaks Schengen (already over from Spain) or fits?
    const plan = overview.plans.stays.find(item => item.rule.id === SCHENGEN_RULE.id);
    assert.equal(plan.lastDay, '2026-11-20');
    assert.equal(plan.fits, false);
    assert.ok(plan.firstBreach >= '2026-11-01');
    const franceTax = overview.plans.thresholds.find(item => item.countries[0] === 'FRA');
    assert.deepEqual([franceTax.count, franceTax.reached], [74, false]);

    // Counters for a calendar year and a rolling window.
    const ledger = buildLedger(markers, countryOf, { today });
    assert.deepEqual(countryCounters(ledger, '2025-01-01', '2025-12-31'), [{ countryId: 'USA', days: 12 }]);
    assert.deepEqual(countryCounters(ledger, '2026-01-01', '2026-01-31').map(row => [row.countryId, row.days]), [['PRT', 16], ['USA', 5]]);
});

test('a plan that fits is reported with the days left after it', async () => {
    const { ledgerOverview } = await load();
    const overview = ledgerOverview({
        markers: [place('FRA', [['2026-09-01', '2026-09-30']])],
        countryOf,
        settings: { dayRule: 'presence', rules: [], planned: [{ id: 'p', countryId: 'ITA', startDate: '2026-11-01', endDate: '2026-11-10' }, { id: 'q', countryId: 'GBR', startDate: '2026-12-01', endDate: '2026-12-02' }] },
        today: '2026-10-23'
    });
    assert.deepEqual(overview.plans.stays.map(item => [item.rule.id, item.fits, item.remaining, item.lastDay]), [['schengen', true, 50, '2026-11-10']]);
    assert.deepEqual(overview.plans.thresholds.map(item => [item.countries[0], item.count]), [['GBR', 2], ['ITA', 10]]);
    assert.deepEqual(overview.alerts, []);
    const empty = ledgerOverview({ markers: [], countryOf, settings: null, today: '2026-10-23' });
    assert.deepEqual([empty.plans, empty.timeline, empty.thresholds.length], [{ stays: [], thresholds: [] }, [], 0]);
});

test('the evidence report lists each day with its source visit and date history', async () => {
    const { buildLedger } = await load();
    const { evidenceReport, buildEvidenceCsv, describeChange, dayNote, EVIDENCE_FIELDS } = await loadEvidence();
    const lisbon = place('PRT', [['2026-05-01', '2026-05-03']], { name: 'Lisbon, Portugal', category: 'City' });
    const porto = place('PRT', [['2026-05-03', '', true]], { name: '=Porto', category: 'City' });
    const madrid = place('ESP', [['2026-04-20']]);
    const visitId = lisbon.visits[0].id;
    const changes = [
        { id: 3, visitId: 999, action: 'removed', placeName: 'Faro', oldStartDate: '2026-05-02', oldEndDate: '2026-05-02', oldOngoing: false, changedAt: '2026-10-22T10:00:00.000Z' },
        { id: 2, visitId, action: 'changed', placeName: 'Lisbon, Portugal', oldStartDate: '2026-05-01', oldEndDate: '2026-05-02', oldOngoing: false, newStartDate: '2026-05-01', newEndDate: '2026-05-03', newOngoing: false, changedAt: '2026-10-21T09:00:00.000Z' },
        { id: 1, visitId, action: 'added', placeName: 'Lisbon, Portugal', newStartDate: '2026-05-01', newEndDate: '2026-05-02', newOngoing: false, changedAt: '2026-10-20T08:00:00.000Z' },
        { id: 0, visitId: 1000, action: 'removed', placeName: 'Long ago', oldStartDate: '2020-01-01', oldEndDate: null, oldOngoing: false, changedAt: '2026-10-19T08:00:00.000Z' }
    ];
    const ledger = buildLedger([lisbon, porto, madrid], countryOf, { today: '2026-05-05' });
    const report = evidenceReport(ledger, { countryIds: ['PRT', 'ESP'], from: '2026-04-01', to: '2026-05-04', changes });

    assert.deepEqual(report.totals, [{ countryId: 'PRT', days: 4 }, { countryId: 'ESP', days: 1 }]);
    assert.deepEqual(report.rows.map(row => [row.date, row.countryId, row.sources.length]), [
        ['2026-04-20', 'ESP', 1], ['2026-05-01', 'PRT', 1], ['2026-05-02', 'PRT', 1], ['2026-05-03', 'PRT', 2], ['2026-05-04', 'PRT', 1]
    ]);
    assert.equal(report.rows[0].sources[0].note, 'End not recorded: first day only');
    assert.deepEqual(report.rows[3].sources.map(source => source.note).sort(), ['Arrival day; still there', 'Departure day']);
    assert.deepEqual(report.rows[1].sources[0].history, ['Added 2026-05-01 – 2026-05-02', 'Changed 2026-05-01 – 2026-05-02 → 2026-05-01 – 2026-05-03']);
    assert.deepEqual(report.changes.map(change => change.id), [1, 2, 3], 'oldest first; removals in the period included');

    const csv = buildEvidenceCsv(report, id => COUNTRIES[id]).split('\r\n');
    assert.equal(csv[0], EVIDENCE_FIELDS.map(field => `"${field}"`).join(','));
    assert.equal(csv.length, 1 + 6);
    assert.match(csv[2], /^"2026-05-01","Portugal","Lisbon, Portugal","City","2026-05-01","2026-05-03","\d+","Arrival day","Any part of a day","Added .*; Changed .*"$/);
    assert.ok(csv.some(line => line.includes('"\'=Porto"')), 'formula-like names are defused');
    assert.ok(csv.some(line => line.includes('"still there"')));

    assert.equal(describeChange({ action: 'removed', oldStartDate: '2026-01-01', oldOngoing: true }), 'Removed 2026-01-01 – still there');
    assert.equal(describeChange({ action: 'added', newStartDate: '2026-01-01', newEndDate: '2026-01-01' }), 'Added 2026-01-01');
    assert.equal(describeChange({ action: 'added', newStartDate: '2026-01-01' }), 'Added 2026-01-01 – end not recorded');
    assert.equal(describeChange({ action: 'changed', oldStartDate: '2026-01-01', newStartDate: '2026-01-02', newOngoing: true }, iso => iso.slice(5)),
        'Changed 01-01 – end not recorded → 01-02 – still there');
    assert.deepEqual(report.rows.map(row => row.sources.map(source => source.edited)).flat(), [false, true, true, true, false, false],
        'only visits whose dates changed count as edited');
    assert.equal(dayNote({ startDate: '2026-01-01', endDate: '2026-01-01', open: null }, '2026-01-01'), 'Arrival and departure day');
    assert.equal(dayNote({ startDate: '2026-01-01', endDate: '2026-01-05', open: null }, '2026-01-03'), 'During the stay');
    assert.equal(dayNote({ startDate: '2026-01-01', open: 'ongoing' }, '2026-01-03'), 'Still there');
});

test('days lived in a country and layovers count as presence days (ADR 0014)', async () => {
    const { buildLedger, daysIn, dayNumber } = await load();
    const country = { lived: { id: 'DEU' }, transit: { id: 'ARE' }, overnight: { id: 'QAT' } };
    const markers = [
        { id: 1, type: 'visited', stay: 'lived', name: 'Berlin', key: 'lived', visits: [{ id: 1, startDate: '2024-01-01', endDate: '2024-01-10' }] },
        { id: 2, type: 'visited', stay: 'transit', name: 'Dubai', key: 'transit', visits: [{ id: 2, startDate: '2024-02-01', endDate: '2024-02-01' }] },
        { id: 3, type: 'visited', stay: 'transit', name: 'Doha', key: 'overnight', visits: [{ id: 3, startDate: '2024-03-01', endDate: '2024-03-02' }] }
    ];
    const count = dayRule => {
        const ledger = buildLedger(markers, marker => country[marker.key], { dayRule, today: '2024-12-31' });
        return ['DEU', 'ARE', 'QAT'].map(id => daysIn(ledger, [id]).length);
    };
    assert.deepEqual(count('presence'), [10, 1, 2], 'any part of a day: every day lived there, and a layover day');
    assert.deepEqual(count('midnight'), [9, 0, 1], 'midnight rule: a layover counts only a night spent there');
    const ledger = buildLedger(markers, marker => country[marker.key], { today: '2024-12-31' });
    assert.equal(daysIn(ledger, ['ARE'])[0], dayNumber('2024-02-01'));
});
