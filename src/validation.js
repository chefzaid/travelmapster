'use strict';

const MARKER_TYPES = new Set(['visited', 'wishlist']);
const MARKER_CATEGORIES = new Set(['Country', 'City']);
const PROFILE_VISIBILITIES = new Set(['private', 'public']);
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything after 72 bytes, so longer passwords are rejected.
const PASSWORD_MAX_BYTES = 72;
const NAME_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 2000;
const PHOTO_URL_MAX_LENGTH = 2048;
const IMPORT_MAX_MARKERS = 1000;
const TRIP_SLOTS = ['morning', 'afternoon', 'evening'];
const TRIP_MAX_DAYS = 30;
const TRIP_SLOT_MAX_LENGTH = 500;

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidTravelDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Passwords are not trimmed: leading or trailing spaces are part of the secret.
function readPassword(value) {
    return typeof value === 'string' ? value : '';
}

function passwordError(password) {
    if (password.length < PASSWORD_MIN_LENGTH) {
        return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
        return `Password must be at most ${PASSWORD_MAX_BYTES} bytes.`;
    }
    return null;
}

function parseCredentials(body) {
    const username = normalizeText(body?.username);
    const password = readPassword(body?.password);

    if (!USERNAME_PATTERN.test(username)) {
        return { error: 'Username must be 3 to 32 letters, digits, dots, dashes or underscores.' };
    }
    const error = passwordError(password);
    if (error) return { error };
    return { credentials: { username, password } };
}

function parsePasswordChange(body) {
    const currentPassword = readPassword(body?.currentPassword);
    const newPassword = readPassword(body?.newPassword);
    if (!currentPassword) return { error: 'Current password is required.' };
    const error = passwordError(newPassword);
    if (error) return { error: error.replace('Password', 'New password') };
    return { change: { currentPassword, newPassword } };
}

function parseMarkerPayload(body) {
    if (!body || typeof body !== 'object') {
        return { error: 'Marker payload must be a JSON object.' };
    }

    const lat = typeof body.lat === 'string' && body.lat.trim() === '' ? NaN : Number(body.lat);
    const lng = typeof body.lng === 'string' && body.lng.trim() === '' ? NaN : Number(body.lng);
    const type = normalizeText(body.type);
    const name = normalizeText(body.name);
    const category = normalizeText(body.category);
    const photoUrl = normalizeText(body.photoUrl);
    const notes = normalizeText(body.notes);
    const travelDate = normalizeText(body.travelDate);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return { error: 'Latitude must be a number between -90 and 90.' };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return { error: 'Longitude must be a number between -180 and 180.' };
    }
    if (!MARKER_TYPES.has(type)) {
        return { error: 'Marker type must be visited or wishlist.' };
    }
    if (!MARKER_CATEGORIES.has(category)) {
        return { error: 'Marker category must be Country or City.' };
    }
    if (!name) {
        return { error: 'Marker name is required.' };
    }
    if (name.length > NAME_MAX_LENGTH) {
        return { error: `Marker name must be ${NAME_MAX_LENGTH} characters or fewer.` };
    }
    if (notes.length > NOTES_MAX_LENGTH) {
        return { error: `Marker notes must be ${NOTES_MAX_LENGTH} characters or fewer.` };
    }
    if (travelDate && !isValidTravelDate(travelDate)) {
        return { error: 'Travel date must be a valid YYYY-MM-DD date.' };
    }
    if (photoUrl) {
        if (photoUrl.length > PHOTO_URL_MAX_LENGTH) {
            return { error: `Photo link must be ${PHOTO_URL_MAX_LENGTH} characters or fewer.` };
        }
        let parsedPhotoUrl;
        try {
            parsedPhotoUrl = new URL(photoUrl);
        } catch {
            return { error: 'Photo link must be a valid URL.' };
        }
        if (!['http:', 'https:'].includes(parsedPhotoUrl.protocol)) {
            return { error: 'Photo link must use HTTP or HTTPS.' };
        }
    }

    return {
        marker: {
            lat,
            lng,
            type,
            name,
            category,
            photoUrl: photoUrl || null,
            notes: notes || null,
            travelDate: travelDate || null
        }
    };
}

function parseTripPayload(body) {
    if (!body || typeof body !== 'object') {
        return { error: 'Trip payload must be a JSON object.' };
    }
    const title = normalizeText(body.title);
    const destination = normalizeText(body.destination);
    const startDate = normalizeText(body.startDate);

    if (!title || title.length > 120) {
        return { error: 'Trip title is required and must be 120 characters or fewer.' };
    }
    if (!destination || destination.length > 160) {
        return { error: 'Trip destination is required and must be 160 characters or fewer.' };
    }
    if (startDate && !isValidTravelDate(startDate)) {
        return { error: 'Start date must be a valid YYYY-MM-DD date.' };
    }
    if (!Array.isArray(body.plan) || body.plan.length < 1 || body.plan.length > TRIP_MAX_DAYS) {
        return { error: `A trip plan must have between 1 and ${TRIP_MAX_DAYS} days.` };
    }

    const plan = [];
    for (const day of body.plan) {
        if (!day || typeof day !== 'object' || Array.isArray(day)) {
            return { error: 'Each trip day must be an object.' };
        }
        const cleanDay = {};
        for (const slot of TRIP_SLOTS) {
            const value = normalizeText(day[slot]);
            if (value.length > TRIP_SLOT_MAX_LENGTH) {
                return { error: `Each itinerary slot must be ${TRIP_SLOT_MAX_LENGTH} characters or fewer.` };
            }
            cleanDay[slot] = value;
        }
        plan.push(cleanDay);
    }

    return { trip: { title, destination, startDate: startDate || null, plan } };
}

function parseMarkerId(value) {
    if (!/^\d{1,15}$/.test(String(value))) return null;
    const id = Number(value);
    return id >= 1 ? id : null;
}

function parseProfileVisibility(body) {
    const profileVisibility = normalizeText(body?.profileVisibility);
    if (!PROFILE_VISIBILITIES.has(profileVisibility)) {
        return { error: 'Profile visibility must be private or public.' };
    }
    return { profileVisibility };
}

module.exports = {
    IMPORT_MAX_MARKERS,
    USERNAME_PATTERN,
    isValidTravelDate,
    normalizeText,
    parseCredentials,
    parsePasswordChange,
    readPassword,
    parseMarkerId,
    parseMarkerPayload,
    parseProfileVisibility,
    parseTripPayload
};
