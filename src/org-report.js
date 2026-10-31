'use strict';

// The employer's report (ADR 0029): for each member, business days per country in a period and
// the status of each employer rule, counted by the browser's own days.js over business visits
// only, with countries found by geo.js; and a forecast of each rule with the business trips
// planned ahead, their days counted as planned stays (itinerary.js). No place names, cities or
// trip dates leave this module.
const { browserModule, countryData, townData } = require('./browser-modules');

const DAY_MS = 86_400_000;
const isoDate = date => date.toISOString().slice(0, 10);

/** Places, each with its visits, from the rows of one member's business visits. */
function placesOf(rows) {
    const places = new Map();
    for (const row of rows) {
        if (!places.has(row.markerId)) {
            places.set(row.markerId, { id: row.markerId, lat: row.lat, lng: row.lng, category: row.category, name: row.name, visits: [] });
        }
        // Dates arrive as YYYY-MM-DD strings (src/db/pool.js).
        places.get(row.markerId).visits.push({ id: row.id, startDate: row.startDate, endDate: row.endDate || '', ongoing: row.ongoing });
    }
    return [...places.values()];
}

/**
 * The report rows: `members` ({ id, username, role }), `visits` (rows of business visits),
 * `trips` (members' business trips not over yet), `rules` (the employer's) and the period from
 * `from` to `to` (YYYY-MM-DD), as of `today`.
 */
async function orgReport({ members, visits, trips = [], rules, from, to, today = isoDate(new Date()) }) {
    const [{ findTown, resolveMarkerCountry }, days, { resolveDestination, tripPlannedStays }, { index }, cities] = await Promise.all([
        browserModule('geo.js'), browserModule('days.js'), browserModule('itinerary.js'), countryData(), townData()
    ]);
    const countryOf = marker => resolveMarkerCountry(index, marker);
    const destinationCountry = destination => resolveDestination(destination, { findCountry: name => index.findByName(name), findCity: name => findTown(cities, name) })?.countryId || null;
    return members.map(member => {
        const mine = row => String(row.userId) === String(member.id);
        const markers = placesOf(visits.filter(mine));
        // Planned days count from today: what is past is in the visits.
        const planned = [];
        let unknownTrips = 0;
        for (const trip of trips.filter(mine)) {
            const { stays, unknown } = tripPlannedStays(trip, destinationCountry);
            if (unknown !== undefined) unknownTrips += 1;
            for (const stay of stays || []) if (stay.endDate >= today) planned.push({ ...stay, startDate: stay.startDate < today ? today : stay.startDate });
        }
        const overview = days.ledgerOverview({ markers, countryOf, settings: { dayRule: 'presence', rules, planned }, today });
        const thresholds = overview.thresholds.filter(item => !item.rule.builtIn);
        const forecastOf = rule => {
            if (!planned.length) return null;
            const stay = overview.plans.stays.find(item => item.rule.id === rule.id);
            if (stay) return { fits: stay.fits, firstBreach: stay.firstBreach };
            const threshold = overview.plans.thresholds.find(item => item.rule.id === rule.id);
            return threshold ? { count: threshold.count, reached: threshold.reached } : null;
        };
        return {
            username: member.username,
            role: member.role,
            plannedTrips: trips.filter(mine).length - unknownTrips,
            unknownTrips,
            countries: days.countryCounters(overview.ledger, from, to)
                .map(({ countryId, days: count }) => ({ countryId, name: index.byId.get(countryId)?.name || countryId, days: count })),
            rules: [
                ...overview.stays.filter(item => !item.rule.builtIn).map(item => ({
                    ruleId: item.rule.id, name: item.rule.name, kind: 'stay', status: days.stayRuleStatus(item),
                    count: item.used, maxDays: item.rule.maxDays, forecast: forecastOf(item.rule)
                })),
                ...thresholds.map(item => ({
                    ruleId: item.rule.id, name: item.rule.name, kind: 'threshold', status: item.status,
                    count: item.count, maxDays: item.rule.maxDays, reachDate: item.reachDate, forecast: forecastOf(item.rule)
                }))
            ]
        };
    });
}

/** The calendar year of a date, as the report's default period. */
function yearOf(today = new Date()) {
    const year = today.getUTCFullYear();
    return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** A valid period of at most ten years, or null. */
function parsePeriod(from, to) {
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        && isoDate(new Date(`${value}T00:00:00Z`)) === value;
    if (!valid(from) || !valid(to) || to < from) return null;
    return (Date.parse(to) - Date.parse(from)) / DAY_MS <= 3660 ? { from, to } : null;
}

module.exports = { orgReport, parsePeriod, yearOf };
