'use strict';

// Validation of the day ledger's settings (ADR 0010): stay rules, thresholds and planned stays.
// src/validation.js re-exports parseLedgerSettings and shares the small helpers below.
const { isValidTravelDate, normalizeText } = require('./validation-text');

const DAY_RULES = new Set(['presence', 'midnight']);
const LEDGER_MAX_RULES = 20;
const LEDGER_MAX_PLANNED = 30;
const LEDGER_MAX_COUNTRIES = 80;
const LEDGER_MAX_WINDOW_DAYS = 3660;
const LEDGER_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const COUNTRY_ID_PATTERN = /^[A-Z]{3}$/;
const DAY_MS = 86_400_000;

function wholeNumber(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function parseCountryIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > LEDGER_MAX_COUNTRIES) {
        return { error: `Choose between 1 and ${LEDGER_MAX_COUNTRIES} countries.` };
    }
    if (!value.every(id => typeof id === 'string' && COUNTRY_ID_PATTERN.test(id))) {
        return { error: 'Countries must be three-letter map codes such as FRA.' };
    }
    return { countries: [...new Set(value)] };
}

/**
 * A stay rule allows at most `maxDays` days in any `windowDays`-day window (Schengen is
 * 90 in 180); a threshold warns before `maxDays` days in a year or a rolling window.
 */
function parseLedgerRule(body) {
    if (!plainObject(body)) return { error: 'Each rule must be an object.' };
    const id = normalizeText(body.id);
    const name = normalizeText(body.name);
    if (!LEDGER_ID_PATTERN.test(id)) return { error: 'Each rule needs an id of up to 40 letters, digits, dashes or underscores.' };
    if (!name || name.length > 80) return { error: 'Rule names are required and must be 80 characters or fewer.' };
    const { countries, error } = parseCountryIds(body.countries);
    if (error) return { error };
    const { kind, maxDays, windowDays, warnDays } = body;
    if (!wholeNumber(warnDays, 0, 365)) return { error: 'Warn days must be a whole number from 0 to 365.' };

    if (kind === 'stay') {
        if (!wholeNumber(windowDays, 1, LEDGER_MAX_WINDOW_DAYS)) return { error: `Window days must be a whole number from 1 to ${LEDGER_MAX_WINDOW_DAYS}.` };
        if (!wholeNumber(maxDays, 1, windowDays)) return { error: 'Allowed days must be a whole number from 1 to the window length.' };
        if (!DAY_RULES.has(body.dayRule)) return { error: 'Day rule must be presence or midnight.' };
        return { rule: { id, kind, name, countries, maxDays, windowDays, warnDays, dayRule: body.dayRule } };
    }
    if (kind === 'threshold') {
        if (body.period === 'year') {
            const yearStart = normalizeText(body.yearStart);
            // February 29 is not allowed: a tax year must start on the same day every year.
            if (!/^\d{2}-\d{2}$/.test(yearStart) || !isValidTravelDate(`2001-${yearStart}`)) {
                return { error: 'Year start must be a MM-DD day such as 01-01 or 04-06.' };
            }
            if (!wholeNumber(maxDays, 1, 366)) return { error: 'Threshold days must be a whole number from 1 to 366.' };
            return { rule: { id, kind, name, countries, maxDays, period: 'year', yearStart, warnDays } };
        }
        if (body.period === 'rolling') {
            if (!wholeNumber(windowDays, 1, LEDGER_MAX_WINDOW_DAYS)) return { error: `Window days must be a whole number from 1 to ${LEDGER_MAX_WINDOW_DAYS}.` };
            if (!wholeNumber(maxDays, 1, windowDays)) return { error: 'Threshold days must be a whole number from 1 to the window length.' };
            return { rule: { id, kind, name, countries, maxDays, period: 'rolling', windowDays, warnDays } };
        }
        return { error: 'Threshold period must be year or rolling.' };
    }
    return { error: 'Rule kind must be stay or threshold.' };
}

function parsePlannedStay(body) {
    if (!plainObject(body)) return { error: 'Each planned stay must be an object.' };
    const id = normalizeText(body.id);
    const countryId = normalizeText(body.countryId);
    const startDate = normalizeText(body.startDate);
    const endDate = normalizeText(body.endDate);
    if (!LEDGER_ID_PATTERN.test(id)) return { error: 'Each planned stay needs an id of up to 40 letters, digits, dashes or underscores.' };
    if (!COUNTRY_ID_PATTERN.test(countryId)) return { error: 'A planned stay needs a three-letter country code such as FRA.' };
    if (!isValidTravelDate(startDate) || !isValidTravelDate(endDate)) {
        return { error: 'A planned stay needs valid YYYY-MM-DD first and last days.' };
    }
    const length = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS;
    if (length < 0) return { error: 'A planned stay must end on or after the day it starts.' };
    if (length >= LEDGER_MAX_WINDOW_DAYS) return { error: `A planned stay can last at most ${LEDGER_MAX_WINDOW_DAYS} days.` };
    return { stay: { id, countryId, startDate, endDate } };
}

function parseList(value, max, label, parseItem) {
    if (!Array.isArray(value)) return { error: `${label} must be an array.` };
    if (value.length > max) return { error: `${label} can hold at most ${max} entries.` };
    const items = [];
    const ids = new Set();
    for (const [index, item] of value.entries()) {
        const result = parseItem(item);
        if (result.error) return { error: `${label} ${index + 1}: ${result.error}` };
        const parsed = result.rule || result.stay;
        if (ids.has(parsed.id)) return { error: `${label} ${index + 1}: ids must be unique.` };
        ids.add(parsed.id);
        items.push(parsed);
    }
    return { items };
}

function parseLedgerSettings(body) {
    if (!plainObject(body)) return { error: 'Ledger settings must be a JSON object.' };
    if (!DAY_RULES.has(body.dayRule)) return { error: 'Day rule must be presence or midnight.' };
    const rules = parseList(body.rules ?? [], LEDGER_MAX_RULES, 'Rule', parseLedgerRule);
    if (rules.error) return { error: rules.error };
    const planned = parseList(body.planned ?? [], LEDGER_MAX_PLANNED, 'Planned stay', parsePlannedStay);
    if (planned.error) return { error: planned.error };
    return { settings: { dayRule: body.dayRule, rules: rules.items, planned: planned.items } };
}

module.exports = { COUNTRY_ID_PATTERN, parseLedgerSettings, plainObject, wholeNumber };
