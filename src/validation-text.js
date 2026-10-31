'use strict';

// Text and date helpers shared by the validation modules, and a visit's companions.
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidTravelDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const COMPANIONS_MAX = 10;
const COMPANION_MAX_LENGTH = 40;

/** Who came along on a visit: at most 10 names of 1–40 characters, each once regardless of case. */
function parseCompanions(value) {
    if (!Array.isArray(value) || value.length > COMPANIONS_MAX) return { error: 'A visit lists at most 10 companions.' };
    const companions = [];
    for (const item of value) {
        const name = normalizeText(item).replace(/\s+/g, ' ');
        if (!name || name.length > COMPANION_MAX_LENGTH) return { error: 'Each companion needs a name of 40 characters or fewer.' };
        if (!companions.some(known => known.toLowerCase() === name.toLowerCase())) companions.push(name);
    }
    return { companions };
}

module.exports = { isValidTravelDate, normalizeText, parseCompanions };
