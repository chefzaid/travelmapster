// Ratings, tags and a custom emoji per place, and the filters built on them (ADR 0012).
// The rules match src/validation.js. Pure functions, unit tested in Node.

export const SUGGESTED_TAGS = ['food', 'hiking', 'family', 'work', 'beach', 'culture'];
export const TAGS_MAX = 8;
export const TAG_MAX_LENGTH = 24;
const TAG_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} &'-]*[\p{L}\p{N}])?$/u;
const EMOJI_MAX_CODE_POINTS = 16;
// Emoji components include the zero-width joiner, variation selector 16 and the keycap.
const EMOJI_PATTERN = /^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

// A few emoji to pick from in one tap; any other single emoji can be typed or pasted.
export const EMOJI_CHOICES = ['❤️', '⭐', '🍜', '🥾', '🏖️', '🏛️', '👨‍👩‍👧', '💼', '🎉', '📸'];

/** Lowercased, trimmed and with single spaces, so "Street  Food" and "street food" match. */
export function normalizeTag(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

/** Tags typed as text, separated by commas or semicolons (also how CSV files hold them). */
export function splitTags(value) {
    if (Array.isArray(value)) return value.map(normalizeTag).filter(Boolean);
    return String(value ?? '').split(/[,;]/).map(normalizeTag).filter(Boolean);
}

export function checkTags(value) {
    const tags = [...new Set(splitTags(value))];
    if (tags.length > TAGS_MAX) return { error: `A place can have at most ${TAGS_MAX} tags.` };
    const bad = tags.find(tag => tag.length > TAG_MAX_LENGTH || !TAG_PATTERN.test(tag));
    if (bad) return { error: `“${bad}” is not a tag: use up to ${TAG_MAX_LENGTH} letters or digits.` };
    return { tags };
}

/** One emoji: a single grapheme made only of emoji characters (flags, keycaps and ZWJ sequences included). */
export function isSingleEmoji(value) {
    if (typeof value !== 'string' || [...value].length > EMOJI_MAX_CODE_POINTS || !EMOJI_PATTERN.test(value)) return false;
    // Emoji components alone also match plain digits, # and *: a keycap or flag needs its partner.
    if (!/[\p{Extended_Pictographic}\u20E3]|\p{Regional_Indicator}{2}/u.test(value)) return false;
    return [...graphemes.segment(value)].length === 1;
}

/** A rating from 1 to 5 stars, or null for none; undefined when the value is not a rating. */
export function parseRating(value) {
    if (value === null || value === undefined || value === '' || value === 0 || value === '0') return null;
    const rating = Number(value);
    return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined;
}

/** Validates the details of a form or an imported record the way the API does. */
export function checkDetails(record) {
    const rating = parseRating(record?.rating);
    if (rating === undefined) return { error: 'A rating is a whole number of stars from 1 to 5.' };
    const { tags, error } = checkTags(record?.tags);
    if (error) return { error };
    const emoji = typeof record?.emoji === 'string' ? record.emoji.trim() : '';
    if (emoji && !isSingleEmoji(emoji)) return { error: 'Choose a single emoji for the pin.' };
    return { details: { rating, tags, emoji } };
}

export function stars(rating) {
    return rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '';
}

export function ratingLabel(rating) {
    if (!rating) return 'Not rated';
    return rating === 1 ? 'Rated 1 star out of 5' : `Rated ${rating} stars out of 5`;
}

/** Tags offered in forms: the suggested ones, then the traveler's own by how often they are used. */
export function knownTags(markers) {
    const counts = new Map();
    for (const marker of markers) {
        for (const tag of marker.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const own = [...counts.keys()].filter(tag => !SUGGESTED_TAGS.includes(tag))
        .sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
    return [...SUGGESTED_TAGS, ...own];
}

/** Tags in use, alphabetically, for the filter. */
export function usedTags(markers) {
    return [...new Set(markers.flatMap(marker => marker.tags || []))].sort((a, b) => a.localeCompare(b));
}

/** The list and map filter: `tag` is 'all' or a tag, `rating` is 'all', 'none' or a minimum. */
export function matchesDetails(marker, { tag = 'all', rating = 'all' } = {}) {
    if (tag !== 'all' && !(marker.tags || []).includes(tag)) return false;
    if (rating === 'none') return !marker.rating;
    if (rating !== 'all' && !((marker.rating || 0) >= Number(rating))) return false;
    return true;
}

export function detailFilterActive(filters) {
    return (filters?.tag ?? 'all') !== 'all' || (filters?.rating ?? 'all') !== 'all';
}

export function describeDetailFilter({ tag = 'all', rating = 'all' } = {}) {
    const parts = [];
    if (tag !== 'all') parts.push(`#${tag}`);
    if (rating === 'none') parts.push('not rated');
    else if (rating === '5') parts.push('★5');
    else if (rating !== 'all') parts.push(`★${rating}+`);
    return parts.join(' · ');
}
