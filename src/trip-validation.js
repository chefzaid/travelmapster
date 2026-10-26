'use strict';

// Validation of trips: the day-by-day plan, the stops, the packing list and the budget.
// src/validation.js re-exports parseTripPayload.
const { isValidTravelDate, normalizeText } = require('./validation-text');
const { plainObject } = require('./ledger-validation');

const TRIP_SLOTS = ['morning', 'afternoon', 'evening'];
const TRIP_MAX_DAYS = 30;
const TRIP_SLOT_MAX_LENGTH = 500;
const TRIP_MAX_STOPS = 10;
const DESTINATION_MAX_LENGTH = 160;
const PACKING_MAX_ITEMS = 200;
const EXPENSES_MAX = 300;
const RATES_MAX = 30;
const LABEL_MAX_LENGTH = 80;
const AMOUNT_MAX = 1_000_000_000;
const RATE_MAX = 1_000_000;
const EXPENSE_CATEGORIES = new Set(['transport', 'stay', 'food', 'activities', 'other']);
// ISO 4217 codes such as EUR or JPY.
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function parsePlan(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > TRIP_MAX_DAYS) {
        return { error: `A trip plan must have between 1 and ${TRIP_MAX_DAYS} days.` };
    }
    const plan = [];
    for (const day of value) {
        if (!plainObject(day)) return { error: 'Each trip day must be an object.' };
        const cleanDay = {};
        for (const slot of TRIP_SLOTS) {
            const text = normalizeText(day[slot]);
            if (text.length > TRIP_SLOT_MAX_LENGTH) {
                return { error: `Each itinerary slot must be ${TRIP_SLOT_MAX_LENGTH} characters or fewer.` };
            }
            cleanDay[slot] = text;
        }
        plan.push(cleanDay);
    }
    return { plan };
}

/**
 * The destinations of a trip with several, in order, each with its number of days. An empty
 * list is a trip to its one destination.
 */
function parseStops(value) {
    if (!Array.isArray(value) || value.length === 1 || value.length > TRIP_MAX_STOPS) {
        return { error: `A trip has no stops, or between 2 and ${TRIP_MAX_STOPS}.` };
    }
    const stops = [];
    for (const stop of value) {
        const destination = plainObject(stop) ? normalizeText(stop.destination) : '';
        if (!destination || destination.length > DESTINATION_MAX_LENGTH) {
            return { error: `Each stop needs a destination of ${DESTINATION_MAX_LENGTH} characters or fewer.` };
        }
        if (!Number.isInteger(stop.days) || stop.days < 1 || stop.days > TRIP_MAX_DAYS) {
            return { error: `Each stop lasts between 1 and ${TRIP_MAX_DAYS} days.` };
        }
        stops.push({ destination, days: stop.days });
    }
    return { stops };
}

function label(value) {
    const text = normalizeText(value);
    return text && text.length <= LABEL_MAX_LENGTH ? text : null;
}

function parsePacking(value) {
    if (!Array.isArray(value) || value.length > PACKING_MAX_ITEMS) {
        return { error: `A packing list holds at most ${PACKING_MAX_ITEMS} items.` };
    }
    const packing = [];
    for (const entry of value) {
        const item = plainObject(entry) ? label(entry.item) : null;
        if (!item) return { error: `Each packing item needs a name of ${LABEL_MAX_LENGTH} characters or fewer.` };
        packing.push({ item, packed: entry.packed === true });
    }
    return { packing };
}

const amountIn = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

function parseRates(value, currency) {
    if (value === undefined) return { rates: {} };
    if (!plainObject(value) || Object.keys(value).length > RATES_MAX) {
        return { error: `Exchange rates must be an object of at most ${RATES_MAX} currencies.` };
    }
    const rates = {};
    for (const [code, rate] of Object.entries(value)) {
        if (!CURRENCY_PATTERN.test(code) || !amountIn(rate, RATE_MAX) || rate === 0) {
            return { error: 'Each exchange rate needs a currency code such as JPY and a positive rate.' };
        }
        // A rate to the budget's own currency is always 1.
        if (code !== currency) rates[code] = Number(rate.toPrecision(10));
    }
    return { rates };
}

function parseExpenses(value) {
    if (value === undefined) return { expenses: [] };
    if (!Array.isArray(value) || value.length > EXPENSES_MAX) {
        return { error: `A budget holds at most ${EXPENSES_MAX} expenses.` };
    }
    const expenses = [];
    for (const entry of value) {
        if (!plainObject(entry)) return { error: 'Each expense must be an object.' };
        const name = label(entry.label);
        if (!name) return { error: `Each expense needs a label of ${LABEL_MAX_LENGTH} characters or fewer.` };
        if (!amountIn(entry.amount, AMOUNT_MAX)) return { error: 'Each expense needs an amount from 0 to 1,000,000,000.' };
        if (typeof entry.currency !== 'string' || !CURRENCY_PATTERN.test(entry.currency)) {
            return { error: 'Each expense needs a currency code such as EUR.' };
        }
        const category = entry.category ?? 'other';
        if (!EXPENSE_CATEGORIES.has(category)) {
            return { error: 'Expense category must be transport, stay, food, activities or other.' };
        }
        expenses.push({ label: name, amount: Math.round(entry.amount * 1000) / 1000, currency: entry.currency, category });
    }
    return { expenses };
}

/**
 * A budget totals its expenses in its own currency (the traveler's home currency), with the
 * exchange rate the traveler enters for each other currency. An empty object means no budget.
 */
function parseBudget(value) {
    if (!plainObject(value)) return { error: 'Budget must be an object.' };
    if (!Object.keys(value).length) return { budget: {} };
    const { currency } = value;
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
        return { error: 'Budget currency must be a code such as EUR.' };
    }
    const planned = value.planned ?? null;
    if (planned !== null && !amountIn(planned, AMOUNT_MAX)) {
        return { error: 'The planned budget must be an amount from 0 to 1,000,000,000.' };
    }
    const { rates, error: ratesError } = parseRates(value.rates, currency);
    if (ratesError) return { error: ratesError };
    const { expenses, error } = parseExpenses(value.expenses);
    if (error) return { error };
    return { budget: { currency, planned, rates, expenses } };
}

/**
 * A trip from the request body. Stops, a packing list or a budget left out stay undefined, so
 * an update keeps the stored ones (previous-release tabs never send them).
 */
function parseTripPayload(body) {
    if (!plainObject(body)) return { error: 'Trip payload must be a JSON object.' };
    const title = normalizeText(body.title);
    const destination = normalizeText(body.destination);
    const startDate = normalizeText(body.startDate);

    if (!title || title.length > 120) {
        return { error: 'Trip title is required and must be 120 characters or fewer.' };
    }
    if (!destination || destination.length > DESTINATION_MAX_LENGTH) {
        return { error: `Trip destination is required and must be ${DESTINATION_MAX_LENGTH} characters or fewer.` };
    }
    if (startDate && !isValidTravelDate(startDate)) {
        return { error: 'Start date must be a valid YYYY-MM-DD date.' };
    }
    const { plan, error: planError } = parsePlan(body.plan);
    if (planError) return { error: planError };
    const trip = { title, destination, startDate: startDate || null, plan };
    if (body.stops !== undefined) {
        const { stops, error } = parseStops(body.stops);
        if (error) return { error };
        trip.stops = stops;
    }
    if (body.packing !== undefined) {
        const { packing, error } = parsePacking(body.packing);
        if (error) return { error };
        trip.packing = packing;
    }
    if (body.budget !== undefined) {
        const { budget, error } = parseBudget(body.budget);
        if (error) return { error };
        trip.budget = budget;
    }
    return { trip };
}

module.exports = { parseTripPayload };
