// Travel history for visa forms: every stay abroad in the last years, with its entry and exit
// days, length and purpose, as UK, US, Canadian and Australian visa applications ask for it.
// Built from the any-part-of-a-day ledger, so entry and exit days are both in the stay. Pure,
// unit tested in Node.
import { addDays, countryStays } from './days.js';
import { csvField } from './ledger-evidence.js';
import { t, tk } from './i18n.js';

export const HISTORY_YEARS = [5, 10];

const PURPOSES = {
    residence: tk('Residence'),
    business: tk('Business'),
    transit: tk('Transit'),
    personal: tk('Tourism or personal')
};

/** A stay's purpose from the visits behind it: lived there, then business, then a layover. */
function purposeOf(sources) {
    const visits = sources.filter(source => source.kind === 'visit');
    if (visits.some(source => source.stay === 'lived')) return 'residence';
    if (visits.some(source => source.purpose === 'business')) return 'business';
    if (visits.length && visits.every(source => source.stay === 'transit')) return 'transit';
    return 'personal';
}

export const purposeLabel = purpose => t(PURPOSES[purpose] || PURPOSES.personal);

/**
 * Stays abroad that touch the `years` before `today`, newest first: `{ countryId, from, to,
 * days, ongoing, unrecorded, purpose, places }`. The home country and planned stays are left out.
 */
export function travelHistory(ledger, { homeId = null, years, today }) {
    const since = addDays(today, -Math.round(years * 365.25));
    return countryStays(ledger)
        .filter(stay => stay.countryId !== homeId && !stay.planned && stay.to >= since && stay.from <= today)
        .map(stay => ({
            countryId: stay.countryId,
            from: stay.from,
            to: stay.to,
            days: stay.days,
            ongoing: stay.ongoing,
            unrecorded: stay.unrecorded,
            purpose: purposeOf(stay.sources),
            places: [...new Set(stay.sources.filter(source => source.kind === 'visit').map(source => source.place.split(',')[0]))]
        }));
}

export const HISTORY_FIELDS = ['country', 'entry', 'exit', 'days', 'purpose', 'places'];

/** The history as CSV, one row per stay. */
export function buildHistoryCsv(history, nameOf = id => id) {
    const rows = [HISTORY_FIELDS, ...history.map(stay => [
        nameOf(stay.countryId), stay.from, stay.ongoing ? t('still there') : stay.to, stay.days, purposeLabel(stay.purpose), stay.places.join('; ')
    ])];
    return rows.map(row => row.map(csvField).join(',')).join('\r\n');
}
