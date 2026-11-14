'use strict';

// Bookings on a trip's days (public/js/bookings.js): checked as the API checks them, sorted by
// time, in the calendar export as timed events, and left out of copies meant for others.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseTripPayload } = require('../src/trip-validation');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));
const flight = { id: 'b1', kind: 'flight', title: 'TP 1352', time: '09:30', address: 'Lisbon airport', code: 'K7Q2LM' };
const hotel = { id: 'b2', kind: 'stay', title: 'Hotel Kanra', time: null, address: null, code: null };

test('a booking from the form is checked as the API checks it', async () => {
    const { checkBooking, bookingKind } = await load('bookings.js');
    const { booking } = checkBooking({ kind: 'flight', title: ' TP 1352 ', time: '09:30', address: ' Lisbon airport ', code: 'K7Q2LM' }, 'b1');
    assert.deepEqual(booking, flight);
    assert.deepEqual(checkBooking({ kind: 'stay', title: 'Hotel Kanra', time: '', address: '', code: '' }, 'b2').booking, hotel);
    const day = parseTripPayload({ title: 'T', destination: 'D', plan: [{ bookings: [booking, hotel] }] }).trip.plan[0];
    assert.deepEqual(day.bookings, [flight, hotel]);
    for (const bad of [{ kind: 'boat' }, { title: '' }, { time: '9:30' }, { time: '24:00' }, { code: 'x'.repeat(41) }, { address: 'x'.repeat(201) }]) {
        assert.ok(checkBooking({ ...flight, ...bad }, 'b').error, JSON.stringify(bad));
        assert.ok(parseTripPayload({ title: 'T', destination: 'D', plan: [{ bookings: [{ ...flight, ...bad }] }] }).error, JSON.stringify(bad));
    }
    assert.ok(parseTripPayload({ title: 'T', destination: 'D', plan: [{ bookings: Array.from({ length: 11 }, (_, i) => ({ ...flight, id: `b${i}` })) }] }).error);
    assert.ok(parseTripPayload({ title: 'T', destination: 'D', plan: [{ bookings: [{ ...flight, id: 'no spaces' }] }] }).error);
    assert.ok(parseTripPayload({ title: 'T', destination: 'D', plan: [{ bookings: 'x' }] }).error);
    assert.ok(parseTripPayload({ title: 'T', destination: 'D', plan: [{ bookings: [null] }] }).error);
    assert.deepEqual(parseTripPayload({ title: 'T', destination: 'D', plan: [{ bookings: [] }] }).trip.plan[0], { morning: '', afternoon: '', evening: '' });
    assert.equal(bookingKind('nope').id, 'other');
});

test('bookings sort by time and read as one line, with or without the confirmation code', async () => {
    const { sortedBookings, bookingLine } = await load('bookings.js');
    const early = { ...hotel, id: 'b3', time: '07:00' };
    assert.deepEqual(sortedBookings([hotel, flight, early]).map(item => item.id), ['b3', 'b1', 'b2']);
    assert.deepEqual(sortedBookings(), []);
    assert.equal(bookingLine(flight), '✈️ 09:30 TP 1352 · Lisbon airport · Confirmation K7Q2LM');
    assert.equal(bookingLine(flight, { code: false }), '✈️ 09:30 TP 1352 · Lisbon airport');
    assert.equal(bookingLine(hotel), '🏨 Hotel Kanra');
});

test('the calendar export holds timed bookings as events of their own, and text copies leave codes out', async () => {
    const { tripCalendar, tripAsText, tripTemplate } = await load('itinerary.js');
    const trip = { id: 7, title: 'Kyoto', destination: 'Kyoto', startDate: '2027-05-01', plan: [{ morning: 'Fly', bookings: [hotel, flight] }, { morning: '' }] };
    // Long lines are folded at 75 bytes; unfolded, each property is one line.
    const calendar = tripCalendar(trip, new Date('2027-01-01T00:00:00Z')).calendar.replace(/\r\n /g, '');
    assert.match(calendar, /DTSTART:20270501T093000\r\nDURATION:PT1H\r\nSUMMARY:✈️ TP 1352\r\nLOCATION:Lisbon airport\r\nDESCRIPTION:Confirmation K7Q2LM/);
    assert.match(calendar, /UID:trip-7-booking-b1@travelmapster/);
    assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 3, 'two days and the timed flight');
    assert.match(calendar, /DESCRIPTION:Morning: Fly\\n✈️ 09:30 TP 1352 · Lisbon airport · Confirmation K7Q2LM\\n🏨 Hotel Kanra/);
    const text = tripAsText(trip);
    assert.ok(text.includes('✈️ 09:30 TP 1352 · Lisbon airport') && !text.includes('K7Q2LM'));
    assert.ok(!('bookings' in tripTemplate(trip).plan[0]), 'a copy of the trip starts without its bookings');
});
