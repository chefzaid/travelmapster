// The bookings on a day card of the trip editor: flights, trains, stays and other reservations
// with their time, address and confirmation code (bookings.js), added, edited and removed in
// the trip's draft and saved with it.
import { h, toast, formDialog } from './ui.js';
import { BOOKINGS_MAX_PER_DAY, BOOKING_KINDS, bookingLine, checkBooking, sortedBookings } from './bookings.js';
import { newId } from './ledger-rules.js';
import { t } from './i18n.js';

async function bookingDialog(booking) {
    let draft = booking || { kind: 'flight', title: '', time: '', address: '', code: '' };
    for (;;) {
        const values = await formDialog({
            title: booking ? t('Edit {name}', { name: booking.title }) : t('Add a booking'),
            submitLabel: booking ? t('Save booking') : t('Add booking'),
            fields: [
                { name: 'kind', label: t('Kind'), type: 'select', value: draft.kind, options: BOOKING_KINDS.map(kind => ({ value: kind.id, label: `${kind.icon} ${t(kind.label)}` })) },
                { name: 'title', label: t('What'), value: draft.title, required: true, maxlength: 80, placeholder: t('TP 1352 to Kyoto, Hotel Kanra…'), autocomplete: 'off' },
                { name: 'time', label: t('Time'), type: 'time', value: draft.time || '', hint: t('Optional: local time. With a time, the calendar export adds it as an event.') },
                { name: 'address', label: t('Address'), value: draft.address || '', maxlength: 200, autocomplete: 'off' },
                { name: 'code', label: t('Confirmation code'), value: draft.code || '', maxlength: 40, autocomplete: 'off', hint: t('Kept with the trip, never in shared copies or the family view.') }
            ]
        });
        if (!values) return null;
        const { booking: checked, error } = checkBooking(values, booking?.id || newId());
        if (!error) return checked;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

/** A day's bookings with buttons to add, edit and remove them. */
export function bookingsBlock(day, { rerender, readOnly }) {
    const bookings = day.bookings || [];
    const save = list => {
        if (list.length) day.bookings = list;
        else delete day.bookings;
        rerender();
    };
    const items = sortedBookings(bookings).map(booking => h('li', { class: 'booking' },
        h('span', {}, bookingLine(booking)),
        readOnly ? null : h('span', { class: 'booking-actions' },
            h('button', {
                type: 'button', class: 'icon-btn', 'aria-label': t('Edit {name}', { name: booking.title }), title: t('Edit'),
                onclick: async () => {
                    const updated = await bookingDialog(booking);
                    if (updated) save(bookings.map(item => (item.id === booking.id ? updated : item)));
                }
            }, '✏️'),
            h('button', {
                type: 'button', class: 'icon-btn', 'aria-label': t('Remove {name}', { name: booking.title }), title: t('Remove'),
                onclick: () => save(bookings.filter(item => item.id !== booking.id))
            }, '✕'))));
    if (readOnly && !items.length) return null;
    return h('div', { class: 'day-bookings' },
        items.length ? h('ul', { class: 'booking-list' }, items) : null,
        readOnly || bookings.length >= BOOKINGS_MAX_PER_DAY ? null : h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: async () => {
                const booking = await bookingDialog();
                if (booking) save([...bookings, booking]);
            }
        }, t('🎫 Add a booking')));
}
