// Import and export helpers for saved places. Pure functions, unit tested in Node.

export const EXPORT_FIELDS = ['id', 'lat', 'lng', 'type', 'name', 'category', 'photoUrl', 'notes', 'travelDate'];

function escapeCsvField(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildCsv(markers) {
    const rows = [EXPORT_FIELDS, ...markers.map(marker => EXPORT_FIELDS.map(field => marker[field]))];
    return rows.map(row => row.map(escapeCsvField).join(',')).join('\r\n');
}

export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '"') {
            if (inQuotes && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (character === ',' && !inQuotes) {
            row.push(field);
            field = '';
        } else if (character === '\n' && !inQuotes) {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (character !== '\r' || inQuotes) {
            field += character;
        }
    }

    if (inQuotes) {
        throw new Error('CSV contains an unterminated quoted field.');
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    if (rows.length === 0) {
        return [];
    }

    const headers = rows.shift().map(header => header.trim().replace(/^﻿/, ''));
    const lowerHeaders = headers.map(header => header.toLowerCase());
    const requiredHeaders = ['lat', 'lng', 'type', 'name', 'category'];
    if (requiredHeaders.some(header => !lowerHeaders.includes(header))) {
        throw new Error('CSV must include lat, lng, type, name, and category columns.');
    }
    // Map case-insensitive headers back to the camelCase export fields.
    const keys = lowerHeaders.map(header => EXPORT_FIELDS.find(field => field.toLowerCase() === header) || header);

    return rows
        .filter(values => values.some(value => value.trim() !== ''))
        .map(values => Object.fromEntries(keys.map((key, index) => [key, values[index] ?? ''])));
}

export function parseImportContent(fileName, content) {
    const extension = fileName.toLowerCase().split('.').pop();
    if (extension === 'json') {
        const parsed = JSON.parse(content);
        const records = Array.isArray(parsed) ? parsed : parsed?.markers;
        if (!Array.isArray(records)) {
            throw new Error('The import file must contain an array of saved places.');
        }
        return records;
    }
    if (extension === 'csv') {
        return parseCsv(content);
    }
    throw new Error('Choose a .json or .csv file.');
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isHttpUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

export function validatePlace(record) {
    const lat = Number(record?.lat);
    const lng = Number(record?.lng);
    const place = {
        lat,
        lng,
        type: text(record?.type),
        name: text(record?.name),
        category: text(record?.category),
        photoUrl: text(record?.photoUrl),
        notes: text(record?.notes),
        travelDate: text(record?.travelDate)
    };

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    if (!['visited', 'wishlist'].includes(place.type)) return null;
    if (!['Country', 'City'].includes(place.category) || !place.name) return null;
    if (place.notes.length > 2000) return null;
    if (place.travelDate && !isValidDate(place.travelDate)) return null;
    if (place.photoUrl && !isHttpUrl(place.photoUrl)) return null;
    return place;
}

// Key used to skip importing a place the user already saved.
export function placeKey(place) {
    return `${place.type}|${place.category}|${String(place.name).trim().toLowerCase()}`;
}
