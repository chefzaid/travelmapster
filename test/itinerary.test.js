// Unit tests for itinerary export (public/js/itinerary.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'itinerary.js'));

const trip = {
    id: 7,
    title: 'Summer in Portugal; sun, sea',
    destination: 'Lisbon, Portugal',
    startDate: '2027-02-27',
    plan: [
        { morning: 'Belém tower', afternoon: '', evening: 'Fado\nin Alfama' },
        { morning: '', afternoon: '', evening: '' },
        { morning: 'Sintra '.repeat(20).trim(), afternoon: 'Café \\ pastries', evening: '' }
    ]
};

test('a trip becomes an all-day calendar event per day, escaped and folded', async () => {
    const { tripCalendar } = await load();
    const { calendar, error } = tripCalendar(trip, new Date('2026-10-26T09:30:15.123Z'));
    assert.equal(error, undefined);
    assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(calendar), 'every line ends with CRLF');
    const lines = calendar.split('\r\n');
    assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, 3);
    assert.ok(lines.includes('X-WR-CALNAME:Summer in Portugal\\; sun\\, sea'));
    assert.ok(lines.includes('DTSTAMP:20261026T093015Z'));
    // Dates run across the end of February into March, each event ending the next day.
    assert.deepEqual(lines.filter(line => line.startsWith('DTSTART')), [
        'DTSTART;VALUE=DATE:20270227', 'DTSTART;VALUE=DATE:20270228', 'DTSTART;VALUE=DATE:20270301'
    ]);
    assert.deepEqual(lines.filter(line => line.startsWith('DTEND')), [
        'DTEND;VALUE=DATE:20270228', 'DTEND;VALUE=DATE:20270301', 'DTEND;VALUE=DATE:20270302'
    ]);
    assert.ok(lines.includes('SUMMARY:Day 1: Summer in Portugal\\; sun\\, sea'));
    assert.ok(lines.includes('LOCATION:Lisbon\\, Portugal'));
    assert.ok(lines.includes('DESCRIPTION:Morning: Belém tower\\nEvening: Fado\\nin Alfama'));
    assert.ok(lines.includes('UID:trip-7-2027-02-27-day-2@travelmapster'));
    // An empty day has no description.
    const second = calendar.split('BEGIN:VEVENT')[2];
    assert.ok(!second.includes('DESCRIPTION'));
    // Long lines are folded at 75 octets, never inside a character.
    const encoder = new TextEncoder();
    assert.ok(lines.every(line => encoder.encode(line).length <= 75));
    const unfolded = calendar.replace(/\r\n /g, '').split('\r\n');
    const long = unfolded.find(line => line.startsWith('DESCRIPTION:Morning: Sintra'));
    assert.equal(long, `DESCRIPTION:Morning: ${'Sintra '.repeat(20).trim()}\\nAfternoon: Café \\\\ pastries`);
});

test('folding counts octets, so accented text never splits a character', async () => {
    const { tripCalendar } = await load();
    const accented = { ...trip, startDate: '2027-01-01', plan: [{ morning: 'é'.repeat(100), afternoon: '', evening: '' }] };
    const { calendar } = tripCalendar(accented);
    const encoder = new TextEncoder();
    for (const line of calendar.split('\r\n')) {
        assert.ok(encoder.encode(line).length <= 75);
        assert.ok(!line.includes('�'));
    }
    assert.ok(calendar.replace(/\r\n /g, '').includes(`DESCRIPTION:Morning: ${'é'.repeat(100)}`));
});

test('a calendar needs a start date', async () => {
    const { tripCalendar } = await load();
    assert.match(tripCalendar({ ...trip, startDate: '' }).error, /start date/);
});

test('a template copies the plans without dates and keeps the title in bounds', async () => {
    const { tripTemplate } = await load();
    const copy = tripTemplate({ ...trip, plan: [{ morning: 'A' }] });
    assert.deepEqual(copy, {
        title: 'Summer in Portugal; sun, sea (copy)', destination: 'Lisbon, Portugal', startDate: '',
        plan: [{ morning: 'A', afternoon: '', evening: '' }]
    });
    assert.equal(tripTemplate({ ...trip, title: 'x'.repeat(120) }).title.length, 120);
    copy.plan[0].morning = 'changed';
    assert.equal(trip.plan[0].morning, 'Belém tower', 'the original is untouched');
});

test('trip text, end dates and file names', async () => {
    const { tripAsText, tripEndDate, tripFileName, dayDate } = await load();
    assert.equal(tripEndDate(trip), '2027-03-01');
    assert.equal(tripEndDate({ ...trip, startDate: '' }), '');
    assert.equal(dayDate('', 1), '');
    const text = tripAsText(trip);
    assert.ok(text.startsWith('Summer in Portugal; sun, sea (Lisbon, Portugal)\n\nDay 1, '));
    assert.ok(text.includes('  Morning: Belém tower'));
    assert.ok(!text.includes('Afternoon: \n'));
    assert.equal(tripFileName(trip, 'ics'), 'summer-in-portugal-sun-sea.ics');
    assert.equal(tripFileName({ title: 'Été à Montréal!' }, 'ics'), 'ete-a-montreal.ics');
    assert.equal(tripFileName({ title: '🌍' }, 'ics'), 'trip.ics');
});
