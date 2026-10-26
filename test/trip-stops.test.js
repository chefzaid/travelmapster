// Unit tests for trips with several destinations (public/js/itinerary.js and trip-stops.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = file => import(path.join(__dirname, '..', 'public', 'js', file));

const day = text => ({ morning: text, afternoon: '', evening: '' });
const tour = () => ({
    id: 3, title: 'Iberia', destination: 'Lisbon, Portugal', startDate: '2027-05-01',
    stops: [{ destination: 'Lisbon, Portugal', days: 2 }, { destination: 'Madrid, Spain', days: 1 }],
    plan: [day('Belém'), day('Sintra'), day('Prado')]
});

test('stops lay over the plan\'s days in turn, with their dates', async () => {
    const { tripStops, stopOfDay, tripRoute, tripAsText, tripCalendar, tripTemplate } = await load('itinerary.js');
    assert.deepEqual(tripStops(tour()), [
        { destination: 'Lisbon, Portugal', firstDay: 0, days: 2, startDate: '2027-05-01', endDate: '2027-05-02' },
        { destination: 'Madrid, Spain', firstDay: 2, days: 1, startDate: '2027-05-03', endDate: '2027-05-03' }
    ]);
    const single = { ...tour(), stops: [], startDate: '' };
    assert.deepEqual(tripStops(single), [{ destination: 'Lisbon, Portugal', firstDay: 0, days: 3, startDate: '', endDate: '' }]);
    // Out of step with the plan (an older tab changed the days): the last stop takes what is left.
    assert.deepEqual(tripStops({ ...tour(), plan: [day(''), day(''), day(''), day('')] }).map(stop => stop.days), [2, 2]);
    assert.deepEqual(tripStops({ ...tour(), plan: [day('')] }).map(stop => [stop.destination, stop.days]), [['Lisbon, Portugal', 1]]);

    assert.equal(stopOfDay(tour(), 2).destination, 'Madrid, Spain');
    assert.equal(tripRoute(tour()), 'Lisbon, Portugal → Madrid, Spain');
    assert.equal(tripRoute(single), 'Lisbon, Portugal');
    const text = tripAsText(tour());
    assert.ok(text.startsWith('Iberia (Lisbon, Portugal → Madrid, Spain)'));
    assert.match(text, /Day 3, [^\n]+, Madrid, Spain\n {2}Morning: Prado/);
    assert.doesNotMatch(tripAsText(single), /Day 1, Lisbon/);
    assert.match(tripCalendar(tour()).calendar, /SUMMARY:Day 3: Iberia\r\nLOCATION:Madrid\\, Spain/);
    assert.deepEqual(tripTemplate(tour()).stops, tour().stops);
});

test('editing stops keeps the plan\'s days and the stops\' days in step', async () => {
    const { addStop, removeStop, renameStop, resizeStop, addTripDay, removeTripDay, MAX_DAYS } = await load('trip-stops.js');
    const { tripStops } = await load('itinerary.js');
    const days = draft => tripStops(draft).map(stop => stop.days);

    // A trip to one place becomes one with stops.
    const draft = { ...tour(), stops: [] };
    assert.equal(addStop(draft), true);
    assert.deepEqual(draft.stops, [{ destination: 'Lisbon, Portugal', days: 3 }, { destination: '', days: 1 }]);
    assert.equal(draft.plan.length, 4);
    renameStop(draft, 1, 'Porto, Portugal');
    renameStop(draft, 0, 'Lisboa');
    assert.equal(draft.destination, 'Lisboa', 'the trip\'s destination is its first stop');
    resizeStop(draft, 0, 1);
    assert.deepEqual(draft.plan.map(item => item.morning), ['Belém', ''], 'days go from the end of the stop');
    resizeStop(draft, 1, 3);
    assert.deepEqual(days(draft), [1, 3]);
    assert.equal(draft.plan.length, 4);
    resizeStop(draft, 1, 99);
    assert.equal(draft.plan.length, MAX_DAYS, 'within the trip\'s limit');
    resizeStop(draft, 1, 0);
    assert.deepEqual(days(draft), [1, 1], 'a stop lasts a day at least');
    resizeStop(draft, 7, 2);
    renameStop(draft, 7, 'Nowhere');
    assert.deepEqual(days(draft), [1, 1], 'an unknown stop changes nothing');

    addTripDay(draft);
    assert.deepEqual(days(draft), [1, 2], 'a new day goes to the last stop');
    removeTripDay(draft, 0);
    assert.deepEqual(draft.stops, [], 'a stop without days goes, and one stop left is a trip without stops');
    assert.equal(draft.destination, 'Porto, Portugal');
    assert.equal(draft.plan.length, 2);

    const trip = tour();
    removeTripDay(trip, 2);
    assert.deepEqual(trip.stops, []);
    assert.equal(trip.destination, 'Lisbon, Portugal');
    removeTripDay(trip, 0);
    removeTripDay(trip, 0);
    assert.equal(trip.plan.length, 1, 'a trip keeps a day');

    const three = tour();
    addStop(three);
    renameStop(three, 2, 'Seville, Spain');
    removeStop(three, 0);
    assert.deepEqual(three.stops, [{ destination: 'Madrid, Spain', days: 1 }, { destination: 'Seville, Spain', days: 1 }]);
    assert.deepEqual(three.plan.map(item => item.morning), ['Prado', '']);
    assert.equal(three.destination, 'Madrid, Spain');
    removeStop(three, 1);
    assert.deepEqual(three.stops, []);
    removeStop(three, 0);
    assert.equal(three.plan.length, 1, 'the last stop stays');

    const full = { ...tour(), plan: Array.from({ length: MAX_DAYS }, () => day('')) };
    assert.equal(addStop(full), false);
    addTripDay(full);
    assert.equal(full.plan.length, MAX_DAYS);
    const single = { ...tour(), stops: [] };
    addTripDay(single);
    assert.deepEqual(single.stops, []);
    assert.equal(single.plan.length, 4);
});
