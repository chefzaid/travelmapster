'use strict';

// Calendar files (public/js/ics.js): events with their days, the ones that look like travel,
// and where they go.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'ics.js'));

const CALENDAR = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'SUMMARY:Lisbon long weekend', 'DTSTART;VALUE=DATE:20260501', 'DTEND;VALUE=DATE:20260504',
    'LOCATION:Hotel Avenida\\, Rua X 12\\, Lisbon\\, Portugal', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Flight to Madrid (IB 3117)', 'DTSTART;TZID=Europe/Lisbon:20260504T183000',
    'DTEND;TZID=Europe/Madrid:20260504T210000', 'LOCATION:Lisbon Airport (LIS)', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Team meeting', 'DTSTART:20260506T090000Z', 'DTEND:20260506T100000Z', 'LOCATION:Room 4B', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Mum\'s birthday', 'DTSTART;VALUE=DATE:20260612', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:A very long title that the calendar folds', 'DTSTART;VALUE=DATE:20260701',
    'DESCRIPTION:Notes', 'LOCATION:Kyoto', ' , Japan', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:No date', 'END:VEVENT',
    'END:VCALENDAR'
].join('\r\n');

test('events keep their days, an all-day end being the day after the last', async () => {
    const { parseCalendar } = await load();
    assert.deepEqual(parseCalendar(CALENDAR).map(({ summary, location, startDate, endDate, allDay, recurring }) => [summary, location, startDate, endDate, allDay, recurring]), [
        ['Lisbon long weekend', 'Hotel Avenida, Rua X 12, Lisbon, Portugal', '2026-05-01', '2026-05-03', true, false],
        ['Flight to Madrid (IB 3117)', 'Lisbon Airport (LIS)', '2026-05-04', '2026-05-04', false, false],
        ['Team meeting', 'Room 4B', '2026-05-06', '2026-05-06', false, false],
        ['Mum\'s birthday', '', '2026-06-12', '2026-06-12', true, true],
        ['A very long title that the calendar folds', 'Kyoto, Japan', '2026-07-01', '2026-07-01', true, false]
    ]);
});

test('travel is all-day, several days, or a flight or a train, never a recurring event', async () => {
    const { parseCalendar, looksLikeTravel } = await load();
    assert.deepEqual(parseCalendar(CALENDAR).filter(looksLikeTravel).map(event => event.summary),
        ['Lisbon long weekend', 'Flight to Madrid (IB 3117)', 'A very long title that the calendar folds']);
});

test('a flight goes where its title says; a stay where its location ends', async () => {
    const { parseCalendar, eventDestinations } = await load();
    const [stay, flight] = parseCalendar(CALENDAR);
    assert.deepEqual(eventDestinations(flight).slice(0, 2), ['Madrid', 'Lisbon Airport (LIS)']);
    assert.deepEqual(eventDestinations(stay).slice(0, 4), ['Hotel Avenida, Rua X 12, Lisbon, Portugal', 'Lisbon, Portugal', 'Lisbon', 'Portugal']);
    assert.deepEqual(eventDestinations({ summary: 'Vol vers Paris', location: '' }), ['Paris', 'Vol vers Paris']);
});
