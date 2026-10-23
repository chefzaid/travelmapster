'use strict';

const MARKER_TYPES = new Set(['visited', 'wishlist']);
// How the traveler was at a place they have been to (ADR 0014); wishlist places are always 'visit'.
const STAYS = new Set(['visit', 'lived', 'transit']);
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

    return { visit: { startDate, endDate: endDate || null, ongoing, notes: notes || null, photoUrl: photoUrl || null } };
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
        visits.push(visit);
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

// ---------------------------------------------------------------- day ledger (ADR 0010)

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

/**
 * Account settings, each optional so a client changes only what it sends: who can see the
 * map, and the home country (a map code, or null or empty to clear it).
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
    if (!Object.keys(profile).length) return { error: 'Send profileVisibility or homeCountry.' };
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
