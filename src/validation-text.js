'use strict';

// Text and date helpers shared by the validation modules.
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidTravelDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

module.exports = { isValidTravelDate, normalizeText };
