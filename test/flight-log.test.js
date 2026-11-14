'use strict';

// Flight log (public/js/flight-log.js and scripts/build-airports.js): airports from OurAirports,
// flights checked as the API checks them, distance and CO₂ per year, and arcs for the map.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { airportRows, readCsv } = require('../scripts/build-airports');
const { parseFlight } = require('../src/flights');

const load = () => import(path.join(__dirname, '..', 'public', 'js', 'flight-log.js'));
const rows = [['KIX', 'Kansai International Airport', 'Osaka', 34.427, 135.244], ['LIS', 'Lisbon Humberto Delgado Airport', 'Lisbon', 38.781, -9.136], ['XXA', 'Lonely strip', '', 0, 0]];

test('the airport list keeps airports with an IATA code and scheduled service, the larger one for a shared code', () => {
    const csv = [
        'id,ident,type,name,latitude_deg,longitude_deg,municipality,scheduled_service,iata_code',
        '1,LPPT,large_airport,"Lisbon Humberto Delgado Airport",38.7813,-9.13592,Lisbon,yes,LIS',
        '2,XX01,small_airport,"Old ""Lisbon"" field",38.8,-9.1,Lisbon,yes,LIS',
        '3,XX02,heliport,Pad,1,1,Somewhere,no,PAD',
        '4,XX03,closed,Gone,1,1,Nowhere,yes,GON',
        '5,XX04,medium_airport,No code,1,1,Here,yes,',
        '6,RJBB,large_airport,Kansai International Airport,34.427299,135.244003,Osaka,yes,kix'
    ].join('\n');
    const records = readCsv(`${csv}\n`);
    assert.equal(records[1].name, 'Old "Lisbon" field');
    assert.deepEqual(airportRows(records), [['KIX', 'Kansai International Airport', 'Osaka', 34.427, 135.244], ['LIS', 'Lisbon Humberto Delgado Airport', 'Lisbon', 38.781, -9.136]]);
    assert.equal(readCsv('a,b\n1,2').length, 1, 'a last line without a newline still counts');
});

test('a flight is checked as the API checks it', async () => {
    const { checkFlight } = await load();
    const { flight } = checkFlight({ date: '2027-05-01', from: ' lis', to: 'KIX', number: 'tp 1352' });
    assert.deepEqual(flight, { date: '2027-05-01', from: 'LIS', to: 'KIX', number: 'TP 1352' });
    assert.deepEqual(parseFlight({ date: '2027-05-01', from: 'lis', to: 'KIX', number: 'tp 1352' }).flight, flight);
    assert.equal(checkFlight({ date: '2027-05-01', from: 'LIS', to: 'KIX', number: '' }).flight.number, null);
    for (const bad of [{ date: '2027-02-30' }, { from: 'LISB' }, { to: 'LIS' }, { number: 'x' }]) {
        const values = { date: '2027-05-01', from: 'LIS', to: 'KIX', ...bad };
        assert.ok(checkFlight(values).error, JSON.stringify(bad));
        assert.ok(parseFlight(values).error, JSON.stringify(bad));
    }
    assert.ok(parseFlight('nope').error);
});

test('flights add up per year with a rough CO₂ estimate, and replay as arcs oldest first', async () => {
    const { airportIndex, airportLabel, flightArcs, flightKm, flightStats, latestFirst, CO2_KG_PER_KM } = await load();
    const airports = airportIndex(rows);
    assert.equal(airportLabel(airports, 'LIS'), 'Lisbon (LIS)');
    assert.equal(airportLabel(airports, 'XXA'), 'Lonely strip (XXA)');
    assert.equal(airportLabel(airports, 'ZZZ'), 'ZZZ');
    const out = { id: 1, date: '2027-05-01', from: 'LIS', to: 'KIX', number: null };
    const back = { id: 2, date: '2027-05-20', from: 'KIX', to: 'LIS', number: null };
    const odd = { id: 3, date: '2026-03-01', from: 'LIS', to: 'ZZZ', number: null };
    const km = flightKm(out, airports);
    assert.ok(km > 11_000 && km < 11_300, `${km}`);
    assert.equal(flightKm(odd, airports), null);
    const { years, total, unknown } = flightStats([back, out, odd], airports);
    assert.deepEqual(years.map(year => [year.year, year.flights]), [['2027', 2], ['2026', 1]]);
    assert.equal(Math.round(total.km), Math.round(2 * km));
    assert.equal(Math.round(total.co2Kg), Math.round(2 * km * CO2_KG_PER_KM));
    assert.deepEqual(unknown, ['ZZZ']);
    assert.deepEqual(latestFirst([odd, out, back, { ...back, id: 9 }]).map(flight => flight.id), [9, 2, 1, 3]);
    const arcs = flightArcs([back, out, odd], airports);
    assert.equal(arcs.length, 2);
    assert.deepEqual(arcs[0][0], [-9.136, 38.781], 'the way out first');
});
