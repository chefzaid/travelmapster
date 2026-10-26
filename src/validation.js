'use strict';

const { isValidTravelDate, normalizeText } = require('./validation-text');
const { COUNTRY_ID_PATTERN, parseLedgerSettings, plainObject, wholeNumber } = require('./ledger-validation');
const { parseTripPayload } = require('./trip-validation');

const MARKER_TYPES = new Set(['visited', 'wishlist']);
// How the traveler was at a place they have been to (ADR 0014); wishlist places are always 'visit'.
const STAYS = new Set(['visit', 'lived', 'transit']);
const MARKER_CATEGORIES = new Set(['Country', 'City']);
const PROFILE_VISIBILITIES = new Set(['private', 'public']);
// Every territory on the map, or UN members and observer states (ADR 0015).
const COUNTRY_LISTS = new Set(['all', 'un']);
// Map colours: the cheerful default, colour-blind safe, or print-friendly (ADR 0016).
const MAP_PALETTES = new Set(['standard', 'colorblind', 'print']);
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything after 72 bytes, so longer passwords are rejected.
const PASSWORD_MAX_BYTES = 72;
const NAME_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 2000;
const PHOTO_URL_MAX_LENGTH = 2048;
const IMPORT_MAX_MARKERS = 1000;
// Enough for every country on the map in one bulk change, and its undo.
const BULK_MAX_CHANGES = 300;
const VISITS_MAX_PER_PLACE = 500;
const RATING_MIN = 1;
const RATING_MAX = 5;
const TAGS_MAX_PER_PLACE = 8;
const TAG_MAX_LENGTH = 24;
// Letters and digits in any script, with inner spaces, dashes, apostrophes or ampersands.
const TAG_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} &'-]*[\p{L}\p{N}])?$/u;
// Long ZWJ sequences (families, kisses with skin tones) stay under 16 code points.
const EMOJI_MAX_CODE_POINTS = 16;
// Emoji components include the zero-width joiner, variation selector 16 and the keycap.
const EMOJI_PATTERN = /^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const PRIORITIES = new Set(['high', 'medium', 'low']);
const GOAL_KINDS = new Set(['countries', 'cities', 'visits']);
const GOALS_MAX = 12;

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

function photoUrlError(photoUrl) {
    if (!photoUrl) return null;
    if (photoUrl.length > PHOTO_URL_MAX_LENGTH) {
        return `Photo link must be ${PHOTO_URL_MAX_LENGTH} characters or fewer.`;
    }
    let parsedPhotoUrl;
    try {
        parsedPhotoUrl = new URL(photoUrl);
    } catch {
        return 'Photo link must be a valid URL.';
    }
    if (!['http:', 'https:'].includes(parsedPhotoUrl.protocol)) {
        return 'Photo link must use HTTP or HTTPS.';
    }
    return null;
}

/**
 * A visit is a span of plain calendar dates. Without an end date it is either still going
 * on (`ongoing`) or its end was not recorded (ADR 0010).
 */
function parseVisitPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Visit payload must be a JSON object.' };
    }
    const startDate = normalizeText(body.startDate);
    const endDate = normalizeText(body.endDate);
    const notes = normalizeText(body.notes);
    const photoUrl = normalizeText(body.photoUrl);

    if (!isValidTravelDate(startDate)) {
        return { error: 'Visit start date must be a valid YYYY-MM-DD date.' };
    }
    if (endDate && !isValidTravelDate(endDate)) {
        return { error: 'Visit end date must be a valid YYYY-MM-DD date.' };
    }
    if (body.ongoing !== undefined && body.ongoing !== null && typeof body.ongoing !== 'boolean') {
        return { error: 'Visit ongoing must be true or false.' };
    }
    const ongoing = body.ongoing === true;
    if (ongoing && endDate) {
        return { error: 'A visit that is still going on has no end date yet.' };
    }
    // ISO dates compare correctly as strings.
    if (endDate && endDate < startDate) {
        return { error: 'Visit end date must be on or after the start date.' };
    }
    if (notes.length > NOTES_MAX_LENGTH) {
        return { error: `Visit notes must be ${NOTES_MAX_LENGTH} characters or fewer.` };
    }
    const error = photoUrlError(photoUrl);
    if (error) return { error };
    // Personal by default, or business for one of the traveler's organizations (ADR 0029); left
    // out, an update keeps the stored purpose (previous-release tabs never send it).
    let purpose;
    let organizationId = null;
    if (body.purpose !== undefined) {
        if (body.purpose !== 'personal' && body.purpose !== 'business') return { error: 'Visit purpose must be personal or business.' };
        purpose = body.purpose;
        if (purpose === 'business') {
            organizationId = parseMarkerId(body.organizationId);
            if (!organizationId) return { error: 'A business visit needs the organization it was for.' };
        }
    }

    return { visit: { startDate, endDate: endDate || null, ongoing, notes: notes || null, photoUrl: photoUrl || null, purpose, organizationId } };
}

function parseVisitList(value) {
    if (!Array.isArray(value)) return { error: 'Visits must be an array.' };
    if (value.length > VISITS_MAX_PER_PLACE) {
        return { error: `A place can have at most ${VISITS_MAX_PER_PLACE} visits.` };
    }
    const visits = [];
    for (const [index, item] of value.entries()) {
        const { visit, error } = parseVisitPayload(item);
        if (error) return { error: `Visit ${index + 1}: ${error}` };
        // Places and imports make personal visits; a visit is marked business on its own (ADR 0029).
        visits.push({ ...visit, purpose: 'personal', organizationId: null });
    }
    return { visits };
}

/** Lowercased, trimmed and with single spaces, so "Street  Food" and "street food" match. */
function normalizeTag(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function parseTags(value) {
    if (value === null) return { tags: [] };
    if (!Array.isArray(value)) return { error: 'Tags must be an array of words.' };
    const tags = [...new Set(value.map(normalizeTag))];
    if (tags.length > TAGS_MAX_PER_PLACE) return { error: `A place can have at most ${TAGS_MAX_PER_PLACE} tags.` };
    if (!tags.every(tag => tag.length <= TAG_MAX_LENGTH && TAG_PATTERN.test(tag))) {
        return { error: `Tags are 1 to ${TAG_MAX_LENGTH} letters or digits, with spaces, dashes, apostrophes or ampersands inside.` };
    }
    return { tags };
}

/** One emoji: a single grapheme made only of emoji characters (flags, keycaps and ZWJ sequences included). */
function isSingleEmoji(value) {
    if ([...value].length > EMOJI_MAX_CODE_POINTS || !EMOJI_PATTERN.test(value)) return false;
    // Emoji_Component alone also matches plain digits, # and *: a keycap or flag needs its partner.
    if (!/[\p{Extended_Pictographic}\u20E3]|\p{Regional_Indicator}{2}/u.test(value)) return false;
    let count = 0;
    for (const segment of graphemes.segment(value)) {
        count += 1;
        if (count > 1 || !segment.segment) return false;
    }
    return count === 1;
}

/**
 * Optional details of a place (ADR 0012, 0013). A field left out stays undefined, so an update
 * from an older client keeps what is stored; null or an empty value clears it.
 */
function parsePlaceDetails(body) {
    const details = {};
    if (body.rating !== undefined) {
        if (body.rating === null || body.rating === '') details.rating = null;
        else if (Number.isInteger(body.rating) && body.rating >= RATING_MIN && body.rating <= RATING_MAX) details.rating = body.rating;
        else return { error: `Rating must be a whole number from ${RATING_MIN} to ${RATING_MAX}.` };
    }
    if (body.tags !== undefined) {
        const { tags, error } = parseTags(body.tags);
        if (error) return { error };
        details.tags = tags;
    }
    if (body.emoji !== undefined) {
        const emoji = body.emoji === null ? '' : body.emoji;
        if (typeof emoji !== 'string') return { error: 'Emoji must be text.' };
        const trimmed = emoji.trim();
        if (trimmed && !isSingleEmoji(trimmed)) return { error: 'Emoji must be a single emoji.' };
        details.emoji = trimmed || null;
    }
    if (body.hideFromPublic !== undefined) {
        if (body.hideFromPublic !== null && typeof body.hideFromPublic !== 'boolean') {
            return { error: 'hideFromPublic must be true or false.' };
        }
        details.hideFromPublic = body.hideFromPublic === true;
    }
    if (body.priority !== undefined) {
        if (body.priority !== null && body.priority !== '' && !PRIORITIES.has(body.priority)) {
            return { error: 'Priority must be high, medium or low.' };
        }
        details.priority = body.priority || null;
    }
    if (body.bestMonths !== undefined) {
        const months = body.bestMonths ?? [];
        if (!Array.isArray(months) || !months.every(month => wholeNumber(month, 1, 12))) {
            return { error: 'Best months must be a list of month numbers from 1 to 12.' };
        }
        details.bestMonths = [...new Set(months)].sort((a, b) => a - b);
    }
    if (body.stay !== undefined) {
        if (body.stay !== null && body.stay !== '' && !STAYS.has(body.stay)) {
            return { error: 'Stay must be visit, lived or transit.' };
        }
        details.stay = body.stay || 'visit';
    }
    return { details };
}

/**
 * Only places the traveler has been to are lived in or passed through. A wishlist place is
 * always a plain visit, so changing a place to the wishlist resets how they were there.
 */
function stayForType(type, stay) {
    if (type !== 'wishlist') return { stay };
    if (stay && stay !== 'visit') return { error: 'Only places you have been to can be lived in or transit only.' };
    return { stay: 'visit' };
}

/**
 * Validates a place. With `withVisits`, an optional `visits` array is parsed too
 * (creating and importing); updates manage visits through their own routes. A
 * `travelDate` left out stays undefined so an update keeps the visits as they are.
 */
function parseMarkerPayload(body, { withVisits = false } = {}) {
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
    const error = photoUrlError(photoUrl);
    if (error) return { error };
    const { details, error: detailsError } = parsePlaceDetails(body);
    if (detailsError) return { error: detailsError };
    const { stay, error: stayError } = stayForType(type, details.stay);
    if (stayError) return { error: stayError };

    /** @type {Record<string, any>} */
    const marker = {
        lat,
        lng,
        type,
        name,
        category,
        photoUrl: photoUrl || null,
        notes: notes || null,
        travelDate: body.travelDate === undefined ? undefined : travelDate || null,
        ...details,
        ...(stay && { stay })
    };
    if (withVisits && body.visits !== undefined && body.visits !== null) {
        const { visits, error: visitError } = parseVisitList(body.visits);
        if (visitError) return { error: visitError };
        marker.visits = visits;
    }
    return { marker };
}

/**
 * A bulk change of places, applied all or nothing: places to create, status changes
 * (`{ id, type }`, with an optional `stay`) and ids to remove. Marking several countries at once and undoing it are
 * each one bulk change.
 */
function parseBulkChanges(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Bulk changes must be a JSON object.' };
    }
    const { create = [], update = [], remove = [] } = body;
    if (![create, update, remove].every(Array.isArray)) {
        return { error: 'create, update and remove must be arrays.' };
    }
    const total = create.length + update.length + remove.length;
    if (total < 1 || total > BULK_MAX_CHANGES) {
        return { error: `Send between 1 and ${BULK_MAX_CHANGES} changes at a time.` };
    }
    const changes = { create: [], update: [], remove: [] };
    for (const [index, item] of create.entries()) {
        const { marker, error } = parseMarkerPayload(item, { withVisits: true });
        if (error) return { error: `Place ${index + 1}: ${error}` };
        changes.create.push(marker);
    }
    const ids = new Set();
    for (const item of update) {
        const id = parseMarkerId(item?.id);
        if (!id) return { error: 'Each status change needs a place id.' };
        if (!MARKER_TYPES.has(item.type)) return { error: 'Marker type must be visited or wishlist.' };
        if (item.stay !== undefined && !STAYS.has(item.stay)) return { error: 'Stay must be visit, lived or transit.' };
        const { stay, error } = stayForType(item.type, item.stay);
        if (error) return { error };
        ids.add(id);
        // A stay left out keeps the stored one (previous-release tabs never send it).
        changes.update.push({ id, type: item.type, stay: stay ?? null });
    }
    for (const value of remove) {
        const id = parseMarkerId(value);
        if (!id) return { error: 'Places to remove must be ids.' };
        ids.add(id);
        changes.remove.push(id);
    }
    if (ids.size !== changes.update.length + changes.remove.length) {
        return { error: 'Change or remove each place at most once.' };
    }
    return { changes };
}

function parseMarkerId(value) {
    if (!/^\d{1,15}$/.test(String(value))) return null;
    const id = Number(value);
    return id >= 1 ? id : null;
}

/**
 * Yearly goals: at most one per kind and year, such as three new countries in 2027, sorted by
 * year and kind.
 */
function parseGoals(value) {
    if (!Array.isArray(value) || value.length > GOALS_MAX) return { error: `Goals must be a list of at most ${GOALS_MAX}.` };
    const goals = [];
    const keys = new Set();
    for (const item of value) {
        if (!plainObject(item) || !wholeNumber(item.year, 2000, 2100) || !GOAL_KINDS.has(item.kind) || !wholeNumber(item.target, 1, 999)) {
            return { error: 'Each goal needs a year from 2000 to 2100, a kind (countries, cities or visits) and a target from 1 to 999.' };
        }
        const key = `${item.year}:${item.kind}`;
        if (keys.has(key)) return { error: 'Set one goal of each kind per year.' };
        keys.add(key);
        goals.push({ year: item.year, kind: item.kind, target: item.target });
    }
    return { goals: goals.sort((a, b) => a.year - b.year || a.kind.localeCompare(b.kind)) };
}

/**
 * Account settings, each optional so a client changes only what it sends: who can see the
 * map, the home country (a map code, or null or empty to clear it), the list of countries
 * the passport counts against, the map palette and whether a public map shows journey lines.
 */
function parseProfile(body) {
    if (!plainObject(body)) return { error: 'Profile changes must be a JSON object.' };
    const profile = {};
    if (body.profileVisibility !== undefined) {
        const profileVisibility = normalizeText(body.profileVisibility);
        if (!PROFILE_VISIBILITIES.has(profileVisibility)) {
            return { error: 'Profile visibility must be private or public.' };
        }
        profile.profileVisibility = profileVisibility;
    }
    if (body.homeCountry !== undefined) {
        const homeCountry = body.homeCountry ?? '';
        if (typeof homeCountry !== 'string' || (homeCountry && !COUNTRY_ID_PATTERN.test(homeCountry))) {
            return { error: 'Home country must be a three-letter map code such as FRA.' };
        }
        profile.homeCountry = homeCountry || null;
    }
    if (body.countryList !== undefined) {
        if (!COUNTRY_LISTS.has(body.countryList)) return { error: 'Country list must be all or un.' };
        profile.countryList = body.countryList;
    }
    if (body.mapPalette !== undefined) {
        if (!MAP_PALETTES.has(body.mapPalette)) return { error: 'Map palette must be standard, colorblind or print.' };
        profile.mapPalette = body.mapPalette;
    }
    if (body.publicJourneys !== undefined) {
        if (typeof body.publicJourneys !== 'boolean') return { error: 'Public journeys must be true or false.' };
        profile.publicJourneys = body.publicJourneys;
    }
    if (body.publicIndexing !== undefined) {
        if (typeof body.publicIndexing !== 'boolean') return { error: 'Public indexing must be true or false.' };
        profile.publicIndexing = body.publicIndexing;
    }
    if (body.goals !== undefined) {
        const { goals, error } = parseGoals(body.goals);
        if (error) return { error };
        profile.goals = goals;
    }
    if (!Object.keys(profile).length) {
        return { error: 'Send profileVisibility, homeCountry, countryList, mapPalette, publicJourneys, publicIndexing or goals.' };
    }
    return { profile };
}

module.exports = {
    BULK_MAX_CHANGES,
    IMPORT_MAX_MARKERS,
    USERNAME_PATTERN,
    VISITS_MAX_PER_PLACE,
    isSingleEmoji,
    isValidTravelDate,
    normalizeTag,
    normalizeText,
    parseBulkChanges,
    parseCredentials,
    parseLedgerSettings,
    parsePasswordChange,
    readPassword,
    parseMarkerId,
    parseMarkerPayload,
    parseProfile,
    parseTripPayload,
    parseVisitPayload
};
