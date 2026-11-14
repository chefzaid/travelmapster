// Reservations on a trip's days: flights, trains, stays and other bookings, each with a local
// time, an address and a confirmation code when it has them. They live on their day of the
// plan, so they move with it. The rules match src/trip-validation.js. Pure, unit tested in Node.
import { t, tk } from './i18n.js';

export const BOOKINGS_MAX_PER_DAY = 10;
export const BOOKING_KINDS = Object.freeze([
    { id: 'flight', icon: '✈️', label: tk('Flight') },
    { id: 'train', icon: '🚆', label: tk('Train') },
    { id: 'bus', icon: '🚌', label: tk('Bus') },
    { id: 'stay', icon: '🏨', label: tk('Stay') },
    { id: 'car', icon: '🚗', label: tk('Car') },
    { id: 'event', icon: '🎟️', label: tk('Event') },
    { id: 'other', icon: '📌', label: tk('Other booking') }
]);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The kind of a booking, as listed above. */
export const bookingKind = id => BOOKING_KINDS.find(kind => kind.id === id) || BOOKING_KINDS.at(-1);

/** A day's bookings by time, those without a time last, in the order they were added. */
export const sortedBookings = (bookings = []) =>
    bookings.map((booking, order) => ({ booking, order }))
        .sort((a, b) => (a.booking.time || '99').localeCompare(b.booking.time || '99') || a.order - b.order)
        .map(({ booking }) => booking);

/** A booking from the form, or what is wrong with it. */
export function checkBooking(values, id) {
    const text = value => String(value ?? '').trim();
    const booking = { id, kind: values.kind, title: text(values.title), time: text(values.time) || null, address: text(values.address) || null, code: text(values.code) || null };
    if (!BOOKING_KINDS.some(kind => kind.id === booking.kind)) return { error: t('Choose what kind of booking it is.') };
    if (!booking.title || booking.title.length > 80) return { error: t('Name each booking in 1 to 80 characters.') };
    if (booking.time && !TIME_PATTERN.test(booking.time)) return { error: t('A booking time must be HH:MM, such as 09:30.') };
    if ((booking.address || '').length > 200 || (booking.code || '').length > 40) {
        return { error: t('A booking address holds at most 200 characters, and its confirmation code 40.') };
    }
    return { booking };
}

/**
 * One line for a booking: "✈️ 09:30 TP 1352 · Lisbon airport · Confirmation K7Q2LM"; without
 * `code`, the confirmation code is left out, as in a copy meant for others.
 */
export function bookingLine(booking, { code = true } = {}) {
    const head = [bookingKind(booking.kind).icon, booking.time, booking.title].filter(Boolean).join(' ');
    return [head, booking.address, code && booking.code ? t('Confirmation {code}', { code: booking.code }) : null].filter(Boolean).join(' · ');
}
