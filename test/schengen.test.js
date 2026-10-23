// Unit and property tests for the public Schengen calculator (public/js/schengen.js), which
// counts typed-in stays with the day ledger's rules. Property tests use a seeded generator.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'schengen.js'));

// Small, fast, seeded PRNG (mulberry32), as in days.test.js.
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
const between = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));
const shift = (iso, days) => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

test('stay rows are checked like the form shows them', async () => {
    const { checkStays, MAX_STAYS } = await load();
    const today = '2026-10-23';
    const { stays, errors } = checkStays([
        { entry: '2026-01-10', exit: '2026-01-20' },
        { entry: '', exit: '' },
        { entry: '2026-10-01', exit: '' },
        { entry: '', exit: '2026-02-01' },
        { entry: '2026-03-05', exit: '2026-03-01' },
        { entry: '2026-11-01', exit: '' },
        { entry: '2026-02-30', exit: '' },
        { entry: '2000-01-01', exit: '2020-01-01' },
        { entry: '2026-12-01', exit: 'soon' }
    ], today);
    assert.deepEqual(stays, [
        { index: 0, startDate: '2026-01-10', endDate: '2026-01-20', ongoing: false },
        { index: 2, startDate: '2026-10-01', endDate: '', ongoing: true }
    ]);
    assert.deepEqual(errors.map(error => [error.index, error.field]), [[3, 'entry'], [4, 'exit'], [5, 'exit'], [6, 'entry'], [7, 'exit'], [8, 'exit']]);
    assert.match(errors[1].message, /on or after/);
    assert.match(errors[2].message, /planned stay/);

    const many = Array.from({ length: MAX_STAYS + 5 }, (_, i) => ({ entry: shift('2020-01-01', i * 3), exit: shift('2020-01-01', i * 3) }));
    assert.equal(checkStays(many, today).stays.length, MAX_STAYS);
});

test('90 days used fills the window until the first day drops out 180 days later', async () => {
    const { schengenCalculator } = await load();
    const stays = [{ index: 0, startDate: '2026-01-01', endDate: '2026-03-31', ongoing: false }];
    const today = '2026-03-31';

    const full = schengenCalculator(stays, { today });
    assert.equal(full.check.used, 90);
    assert.equal(full.check.remaining, 0);
    assert.equal(full.check.inside, true);
    assert.equal(full.check.windowStart, '2025-10-03');
    assert.deepEqual(full.overstays, []);
    assert.equal(full.stays[0].days, 90);
    assert.equal(full.stays[0].overDays, 0);

    // Staying on one more day would go over.
    const next = schengenCalculator(stays, { today, checkDate: '2026-04-01' });
    assert.deepEqual(next.latest, { continuing: true, days: 0, lastDate: null });

    // 29 June still sees 1 January in its window; 30 June does not.
    const blocked = schengenCalculator(stays, { today, checkDate: '2026-06-29' });
    assert.equal(blocked.check.used, 90);
    assert.equal(blocked.latest.days, 0);
    assert.equal(blocked.latest.continuing, false);
    const open = schengenCalculator(stays, { today, checkDate: '2026-06-30' });
    assert.equal(open.check.used, 89);
    assert.equal(open.check.remaining, 1);
    // A day drops out for every day added, so a fresh 90-day stay fits.
    assert.deepEqual(open.latest, { continuing: false, days: 90, lastDate: '2026-09-27' });
});

test('overstays are listed as runs of days and pinned to the stays that cause them', async () => {
    const { schengenCalculator } = await load();
    const today = '2026-01-15';
    const result = schengenCalculator([
        { index: 0, startDate: '2026-01-01', endDate: '2026-02-28', ongoing: false },
        { index: 1, startDate: '2026-03-10', endDate: '2026-04-20', ongoing: false }
    ], { today });
    // 59 days, then 42 more: the 91st day is 10 April.
    assert.deepEqual(result.overstays, [{ from: '2026-04-10', to: '2026-04-20', days: 11 }]);
    assert.equal(result.stays[0].overDays, 0);
    assert.equal(result.stays[0].planned, false);
    assert.equal(result.stays[1].planned, true);
    assert.equal(result.stays[1].overDays, 11);
    assert.equal(result.stays[1].firstOver, '2026-04-10');
    // The second stay could have lasted until the day before.
    const entering = schengenCalculator([result.stays[0]], { today, checkDate: '2026-03-10' });
    assert.equal(entering.latest.lastDate, '2026-04-09');
});

test('a stay still going on counts through today, and overlapping stays count each day once', async () => {
    const { schengenCalculator } = await load();
    const result = schengenCalculator([
        { index: 0, startDate: '2026-10-14', endDate: '', ongoing: true },
        { index: 1, startDate: '2026-10-10', endDate: '2026-10-15', ongoing: false }
    ], { today: '2026-10-23' });
    assert.equal(result.check.used, 14);
    assert.equal(result.stays[0].days, 10);
    assert.equal(result.latest.continuing, true);
    // 13 days before today leave 77, today included.
    assert.equal(result.latest.lastDate, shift('2026-10-23', 76));
    assert.equal(schengenCalculator([], { today: '2026-10-23' }).check.used, 0);
});

test('property: the latest day never breaks a window, and one more day always would', async () => {
    const { schengenCalculator } = await load();
    const rand = random(90180);
    const today = '2026-06-01';
    // Brute force: the most days in any 180-day window over a set of dates.
    const worst = dates => {
        const sorted = [...dates].sort();
        let max = 0;
        for (const end of sorted) {
            const start = shift(end, -179);
            max = Math.max(max, sorted.filter(day => day >= start && day <= end).length);
        }
        return max;
    };
    const expand = (from, to) => {
        const days = [];
        for (let day = from; day <= to; day = shift(day, 1)) days.push(day);
        return days;
    };
    for (let round = 0; round < 60; round += 1) {
        const stays = [];
        let cursor = shift(today, -between(rand, 100, 400));
        for (let i = between(rand, 1, 4); i > 0; i -= 1) {
            const length = between(rand, 1, 40);
            stays.push({ index: stays.length, startDate: cursor, endDate: shift(cursor, length - 1), ongoing: false });
            cursor = shift(cursor, length + between(rand, 1, 60));
        }
        const checkDate = shift(today, between(rand, -30, 120));
        const result = schengenCalculator(stays, { today, checkDate });
        const before = new Set(stays.flatMap(stay => expand(stay.startDate, stay.endDate)).filter(day => day < checkDate));
        // Windows that were already over before the check date stay out of the question.
        if (worst(before) > 90) continue;
        if (!result.latest.days) {
            assert.ok(worst([...before, checkDate]) > 90, `round ${round}: entering on ${checkDate} must break a window`);
            continue;
        }
        const stay = expand(checkDate, result.latest.lastDate);
        assert.equal(stay.length, result.latest.days);
        assert.ok(worst(new Set([...before, ...stay])) <= 90, `round ${round}: the stay fits`);
        if (result.latest.days < 90) {
            assert.ok(worst(new Set([...before, ...stay, shift(result.latest.lastDate, 1)])) > 90, `round ${round}: one more day breaks it`);
        }
    }
});
