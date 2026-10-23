// Import and export helpers for saved places and their visits. Pure functions, unit tested in Node.
import { checkVisit, isHttpUrl, isValidDate, lastVisitDate, sortVisits } from './visits.js';
import { checkDetails } from './details.js';

export { isHttpUrl, isValidDate };

// `travelDate` is the start of the latest visit, kept so older files and releases still read it.
// Files without the later fields (rating to bestMonths) still import with them empty.
export const EXPORT_FIELDS = ['id', 'lat', 'lng', 'type', 'name', 'category', 'photoUrl', 'notes', 'travelDate',
    'rating', 'tags', 'emoji', 'hideFromPublic', 'priority', 'bestMonths'];
// CSV has one row per visit; JSON nests the visits in each place.
export const VISIT_FIELDS = ['visitStartDate', 'visitEndDate', 'visitNotes', 'visitPhotoUrl', 'visitOngoing'];
const CSV_FIELDS = [...EXPORT_FIELDS, ...VISIT_FIELDS];

function escapeCsvField(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportVisit({ startDate, endDate, notes, photoUrl, ongoing }) {
    return { startDate, endDate: endDate || '', notes: notes || '', photoUrl: photoUrl || '', ongoing: Boolean(ongoing) };
}

export function buildJson(markers) {
    const records = markers.map(marker => ({
        ...Object.fromEntries(EXPORT_FIELDS.map(field => [field, marker[field] ?? ''])),
        travelDate: lastVisitDate(marker),
        tags: marker.tags || [],
        hideFromPublic: Boolean(marker.hideFromPublic),
        bestMonths: marker.bestMonths || [],
        visits: sortVisits(marker.visits).map(exportVisit)
    }));
    return JSON.stringify(records, null, 2);
}

// CSV cells hold one value: tags and month numbers are joined with semicolons, which tags
// never contain.
function csvValue(marker, field) {
    if (field === 'travelDate') return lastVisitDate(marker);
    if (field === 'tags') return (marker.tags || []).join('; ');
    if (field === 'bestMonths') return (marker.bestMonths || []).join(';');
    if (field === 'hideFromPublic') return marker.hideFromPublic ? 'yes' : '';
    return marker[field];
}

export function buildCsv(markers) {
    const rows = [CSV_FIELDS];
    for (const marker of markers) {
        const place = EXPORT_FIELDS.map(field => csvValue(marker, field));
        const visits = sortVisits(marker.visits).map(exportVisit);
        // A place without visits still gets one row, with empty visit columns.
        for (const visit of visits.length ? visits : [null]) {
            rows.push([...place, visit?.startDate, visit?.endDate, visit?.notes, visit?.photoUrl, visit?.ongoing ? 'yes' : '']);
        }
    }
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

    const headers = rows.shift().map(header => header.trim().replace(/^\uFEFF/, ''));
    const lowerHeaders = headers.map(header => header.toLowerCase());
    const requiredHeaders = ['lat', 'lng', 'type', 'name', 'category'];
    if (requiredHeaders.some(header => !lowerHeaders.includes(header))) {
        throw new Error('CSV must include lat, lng, type, name, and category columns.');
    }
    // Map case-insensitive headers back to the camelCase export fields.
    const keys = lowerHeaders.map(header => CSV_FIELDS.find(field => field.toLowerCase() === header) || header);

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

// The visits of an imported record: a JSON `visits` list, the visit columns of a CSV row,
// or, in files from before visits existed, the single travel date.
function recordVisits(record) {
    if (Array.isArray(record?.visits)) return record.visits;
    if (text(record?.visitStartDate) || text(record?.visitEndDate) || text(record?.visitNotes) || text(record?.visitPhotoUrl)) {
        return [{
            startDate: record.visitStartDate, endDate: record.visitEndDate, notes: record.visitNotes,
            photoUrl: record.visitPhotoUrl, ongoing: record.visitOngoing
        }];
    }
    const travelDate = text(record?.travelDate);
    return travelDate ? [{ startDate: travelDate }] : [];
}

/** Returns a place ready for the API, or null when the record or any of its visits is invalid. */
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
        travelDate: '',
        visits: []
    };
    const { details } = checkDetails(record);
    if (!details) return null;
    Object.assign(place, details);
    // JSON says true; CSV says "yes".
    place.hideFromPublic = record?.hideFromPublic === true || /^(true|yes|1)$/i.test(text(record?.hideFromPublic));

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    if (!['visited', 'wishlist'].includes(place.type)) return null;
    if (!['Country', 'City'].includes(place.category) || !place.name) return null;
    if (place.notes.length > 2000) return null;
    if (place.photoUrl && !isHttpUrl(place.photoUrl)) return null;
    for (const item of recordVisits(record)) {
        const { visit } = checkVisit(item);
        if (!visit) return null;
        place.visits.push(visit);
    }
    place.travelDate = lastVisitDate(place);
    return place;
}

const visitKey = visit => [visit.startDate, visit.endDate, visit.ongoing, visit.notes, visit.photoUrl].join('|');

/** Joins records of the same place (one CSV row per visit), dropping repeated visits. */
export function mergePlaces(places) {
    const merged = new Map();
    for (const place of places) {
        const key = placeKey(place);
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { ...place, visits: [...place.visits] });
            continue;
        }
        const seen = new Set(existing.visits.map(visitKey));
        existing.visits.push(...place.visits.filter(visit => !seen.has(visitKey(visit))));
        existing.travelDate = lastVisitDate(existing);
    }
    return [...merged.values()];
}

// Key used to skip importing a place the user already saved.
export function placeKey(place) {
    return `${place.type}|${place.category}|${String(place.name).trim().toLowerCase()}`;
}
