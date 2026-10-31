// Checking the rules, planned stays and periods that do not count edited in the Ledger tab the
// way the API does (ADR 0010).
import { DAY_RULES, SCHENGEN_AREA, dayNumber } from './days.js';
import { isValidDate } from './visits.js';
import { t } from './i18n.js';

/** Country ids from a comma-separated list of names or codes; "Schengen" adds the area. */
export function parseCountryList(text, findCountry) {
    const ids = [];
    const unknown = [];
    // Arabic writes its own comma and semicolon (ADR 0031).
    for (const part of String(text ?? '').split(/[,;\n،؛]+/).map(item => item.trim()).filter(Boolean)) {
        // "Schengen", "espace Schengen", "Schengen-Raum", "منطقة شنغن"…
        if (/(^|[\s-])schengen($|[\s-])|شنغن|شينغن/i.test(part)) {
            ids.push(...SCHENGEN_AREA);
            continue;
        }
        const country = findCountry(part);
        if (country) ids.push(country.id);
        else unknown.push(part);
    }
    return { ids: [...new Set(ids)], unknown };
}

function whole(value) {
    const text = String(value ?? '').trim();
    return /^\d{1,5}$/.test(text) ? Number(text) : NaN;
}

const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Validates a rule from the rule form the way the API does; returns { rule } or { error }. */
export function checkRule(record, countries) {
    const name = String(record?.name ?? '').trim();
    if (!name || name.length > 80) return { error: t('Give the rule a name of up to 80 characters.') };
    if (!countries?.length) return { error: t('Choose at least one country.') };
    if (countries.length > 80) return { error: t('A rule can cover at most 80 countries.') };
    const maxDays = whole(record.maxDays);
    const windowDays = whole(record.windowDays);
    const warnDays = whole(record.warnDays || '0');
    if (!inRange(warnDays, 0, 365)) return { error: t('Warn days must be a whole number from 0 to 365.') };
    const base = { id: record.id, kind: record.kind, name, countries };

    if (record.kind === 'stay') {
        if (!inRange(windowDays, 1, 3660)) return { error: t('The window must be 1 to 3,660 days.') };
        if (!inRange(maxDays, 1, windowDays)) return { error: t('Allowed days must be at least 1 and no more than the window.') };
        const dayRule = DAY_RULES[record.dayRule] ? record.dayRule : 'presence';
        return { rule: { ...base, maxDays, windowDays, warnDays, dayRule } };
    }
    if (record.period === 'rolling') {
        if (!inRange(windowDays, 1, 3660)) return { error: t('The window must be 1 to 3,660 days.') };
        if (!inRange(maxDays, 1, windowDays)) return { error: t('Threshold days must be at least 1 and no more than the window.') };
        return { rule: { ...base, maxDays, period: 'rolling', windowDays, warnDays } };
    }
    const yearStart = String(record.yearStart || '01-01').trim();
    if (!/^\d{2}-\d{2}$/.test(yearStart) || !isValidDate(`2001-${yearStart}`)) {
        return { error: t('The year starts on a MM-DD day such as 01-01 or 04-06.') };
    }
    if (!inRange(maxDays, 1, 366)) return { error: t('Threshold days must be from 1 to 366.') };
    return { rule: { ...base, maxDays, period: 'year', yearStart, warnDays } };
}

export function checkPlannedStay(record) {
    const stay = {
        id: record?.id,
        countryId: String(record?.countryId ?? ''),
        startDate: String(record?.startDate ?? '').trim(),
        endDate: String(record?.endDate ?? '').trim()
    };
    if (!/^[A-Z]{3}$/.test(stay.countryId)) return { error: t('Choose the country of the planned stay.') };
    if (!isValidDate(stay.startDate) || !isValidDate(stay.endDate)) return { error: t('Choose the first and last day of the planned stay.') };
    if (stay.endDate < stay.startDate) return { error: t('The planned stay must end on or after the day it starts.') };
    if (dayNumber(stay.endDate) - dayNumber(stay.startDate) >= 3660) return { error: t('A planned stay can last at most 3,660 days.') };
    return { stay };
}

/** A period whose days do not count, checked as the API checks it, with its countries' ids. */
export function checkExemption(record, countries) {
    const period = {
        id: record?.id,
        label: String(record?.label ?? '').trim(),
        countries,
        startDate: String(record?.startDate ?? '').trim(),
        endDate: String(record?.endDate ?? '').trim()
    };
    if (!period.label || period.label.length > 80) return { error: t('Name the permit or visa in 1 to 80 characters.') };
    if (!countries.length) return { error: t('Name at least one country.') };
    if (!isValidDate(period.startDate) || !isValidDate(period.endDate)) return { error: t('Choose the first and last day of the period.') };
    if (period.endDate < period.startDate) return { error: t('A period must end on or after the day it starts.') };
    return { period };
}

/** A short random id for rules and planned stays. */
export function newId(random = Math.random) {
    return `${Date.now().toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}
