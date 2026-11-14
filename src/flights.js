'use strict';

// Flight log: a traveler's flights by date and IATA airport codes, with an optional flight
// number. The browser knows the airports (public/data/airports.json) and draws and counts them.
const { isValidTravelDate, normalizeText } = require('./validation-text');

const FLIGHTS_MAX = 2000;
const CODE_PATTERN = /^[A-Z]{3}$/;
const NUMBER_PATTERN = /^[A-Z0-9]{2,3} ?\d{1,4}[A-Z]?$/;
const COLUMNS = 'id, flown_on AS "date", origin AS "from", destination AS "to", flight_number AS "number"';

/** A flight from the request body: a date, two different airport codes and an optional number. */
function parseFlight(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'A flight must be a JSON object.' };
    const date = normalizeText(body.date);
    const from = normalizeText(body.from).toUpperCase();
    const to = normalizeText(body.to).toUpperCase();
    const number = normalizeText(body.number).toUpperCase();
    if (!isValidTravelDate(date)) return { error: 'A flight needs a valid YYYY-MM-DD date.' };
    if (!CODE_PATTERN.test(from) || !CODE_PATTERN.test(to)) return { error: 'A flight goes between two three-letter airport codes, such as LIS and KIX.' };
    if (from === to) return { error: 'A flight lands at another airport than the one it left.' };
    if (number && !NUMBER_PATTERN.test(number)) return { error: 'A flight number looks like TP 1352.' };
    return { flight: { date, from, to, number: number || null } };
}

function createFlightRepository(db) {
    return {
        /** The traveler's flights, the latest first. */
        async list(userId) {
            const { rows } = await db.query(`SELECT ${COLUMNS} FROM flights WHERE user_id = $1 ORDER BY flown_on DESC, id DESC`, [userId]);
            return rows;
        },
        /** Adds a flight; null once the log holds 2,000. */
        async add(userId, flight) {
            const { rows } = await db.query(
                `INSERT INTO flights (user_id, flown_on, origin, destination, flight_number)
                 SELECT $1, $2, $3, $4, $5 WHERE (SELECT count(*) FROM flights WHERE user_id = $1) < $6
                 RETURNING ${COLUMNS}`,
                [userId, flight.date, flight.from, flight.to, flight.number, FLIGHTS_MAX]
            );
            return rows[0] || null;
        },
        async remove(userId, id) {
            const { rowCount } = await db.query('DELETE FROM flights WHERE id = $1 AND user_id = $2', [id, userId]);
            return rowCount > 0;
        }
    };
}

module.exports = { FLIGHTS_MAX, createFlightRepository, parseFlight };
