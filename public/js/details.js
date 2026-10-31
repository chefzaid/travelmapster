// Ratings, tags, a custom emoji and wishlist plans per place, and the filters and wishlist
// order built on them (ADR 0012).
// The rules match src/validation.js. Pure functions, unit tested in Node.
import { formatList, locale, t, tn } from './i18n.js';
import { visitedWith } from './companions.js';

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
    if (tags.length > TAGS_MAX) return { error: t('A place can have at most {TAGS_MAX} tags.', { TAGS_MAX }) };
    const bad = tags.find(tag => tag.length > TAG_MAX_LENGTH || !TAG_PATTERN.test(tag));
    if (bad) return { error: t('“{bad}” is not a tag: use up to {TAG_MAX_LENGTH} letters or digits.', { bad, TAG_MAX_LENGTH }) };
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

export const PRIORITIES = [
    { value: 'high', get label() { return t('🔥 Must go'); } },
    { value: 'medium', get label() { return t('⭐ Would love to'); } },
    { value: 'low', get label() { return t('💭 Someday'); } }
];
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * A month's name (1–12) in the interface's language, in full or short.
 * @param {number} month
 * @param {'long' | 'short'} width
 */
export function monthName(month, width = 'long') {
    return new Intl.DateTimeFormat(locale(), { month: width, timeZone: 'UTC' }).format(Date.UTC(2000, month - 1, 1));
}

export function priorityLabel(priority) {
    return PRIORITIES.find(item => item.value === priority)?.label || '';
}

/** Month numbers from a list, or from text such as "4;5;6" in a CSV cell. */
export function checkMonths(value) {
    const items = Array.isArray(value) ? value : String(value ?? '').split(/[;,\s]+/).filter(Boolean);
    const months = items.map(Number);
    if (!months.every(month => Number.isInteger(month) && month >= 1 && month <= 12)) {
        return { error: t('Best months are month numbers from 1 to 12.') };
    }
    return { months: [...new Set(months)].sort((a, b) => a - b) };
}

/** Validates the details of a form or an imported record the way the API does. */
export function checkDetails(record) {
    const rating = parseRating(record?.rating);
    if (rating === undefined) return { error: t('A rating is a whole number of stars from 1 to 5.') };
    const { tags, error } = checkTags(record?.tags);
    if (error) return { error };
    const emoji = typeof record?.emoji === 'string' ? record.emoji.trim() : '';
    if (emoji && !isSingleEmoji(emoji)) return { error: t('Choose a single emoji for the pin.') };
    const priority = typeof record?.priority === 'string' ? record.priority.trim() : '';
    if (priority && !(priority in PRIORITY_ORDER)) return { error: t('Priority is high, medium or low.') };
    const { months, error: monthError } = checkMonths(record?.bestMonths);
    if (monthError) return { error: monthError };
    return { details: { rating, tags, emoji, priority: priority || null, bestMonths: months } };
}

/** "Apr–Jun", "Nov–Feb" across the new year, "Mar, Sep" or "All year". */
export function monthsLabel(months = []) {
    if (!months.length) return '';
    if (months.length === 12) return t('All year');
    const set = new Set(months);
    const short = month => monthName(month, 'short');
    // Start each run at a month whose previous month is not chosen, so runs wrap past December.
    const starts = months.filter(month => !set.has(month === 1 ? 12 : month - 1));
    return formatList(starts.map(start => {
        let end = start;
        while (set.has(end === 12 ? 1 : end + 1)) end = end === 12 ? 1 : end + 1;
        return end === start ? short(start) : `${short(start)}–${short(end)}`;
    }));
}

/** How many months from `month` until the next chosen month (0 = this month), or null. */
export function monthsUntil(bestMonths, month) {
    if (!bestMonths?.length) return null;
    return Math.min(...bestMonths.map(best => (best - month + 12) % 12));
}

/**
 * Wishlist places by the next month that suits them, starting with this month; within a
 * month, higher priority first, then by name. Places without months come last.
 * Returns [title, places] groups for the places list.
 */
export function groupByNextMonth(markers, month) {
    const groups = new Map();
    for (const marker of markers) {
        const wait = monthsUntil(marker.bestMonths, month);
        if (!groups.has(wait)) groups.set(wait, []);
        groups.get(wait).push(marker);
    }
    const rank = marker => PRIORITY_ORDER[marker.priority] ?? 3;
    const title = wait => {
        if (wait === null) return t('No month chosen');
        const name = monthName(((month - 1 + wait) % 12) + 1);
        if (wait === 0) return t('{month} (this month)', { month: name });
        return wait === 1 ? t('{month} (next month)', { month: name }) : name;
    };
    return [...groups.entries()]
        .sort(([a], [b]) => (a ?? 12) - (b ?? 12))
        .map(([wait, items]) => [title(wait), items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))]);
}

/** The wishlist place to suggest next: in season soonest, then by priority; null without months. */
export function nextInSeason(markers, month) {
    const [first] = groupByNextMonth(markers.filter(marker => marker.type === 'wishlist' && marker.bestMonths?.length), month);
    return first ? first[1][0] : null;
}

export function stars(rating) {
    return rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '';
}

export function ratingLabel(rating) {
    if (!rating) return t('Not rated');
    return tn(rating, 'Rated {count} star out of 5', 'Rated {count} stars out of 5');
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

/**
 * The list and map filter: `tag` is 'all' or a tag, `rating` is 'all', 'none' or a minimum, and
 * `companion` is 'all' or a name someone came along under (companions.js).
 */
export function matchesDetails(marker, { tag = 'all', rating = 'all', companion = 'all' } = {}) {
    if (tag !== 'all' && !(marker.tags || []).includes(tag)) return false;
    if (companion !== 'all' && !visitedWith(marker, companion)) return false;
    if (rating === 'none') return !marker.rating;
    if (rating !== 'all' && !((marker.rating || 0) >= Number(rating))) return false;
    return true;
}

export function detailFilterActive(filters) {
    return ['tag', 'rating', 'companion'].some(key => (filters?.[key] ?? 'all') !== 'all');
}

export function describeDetailFilter({ tag = 'all', rating = 'all', companion = 'all' } = {}) {
    const parts = [];
    if (companion !== 'all') parts.push(t('with {name}', { name: companion }));
    if (tag !== 'all') parts.push(`#${tag}`);
    if (rating === 'none') parts.push(t('not rated'));
    else if (rating === '5') parts.push('★5');
    else if (rating !== 'all') parts.push(`★${rating}+`);
    return parts.join(' · ');
}
