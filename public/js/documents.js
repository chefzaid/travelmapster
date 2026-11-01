// Travel documents in the day ledger: passports, ID cards, visas and residence permits with the
// days they are valid, never their numbers. Warns before one expires, and checks the trips
// ahead against the common rule that a passport stays valid six months after the stay and
// against the dates of a visa for the trip's countries. The rules match
// src/ledger-validation.js. Pure, unit tested in Node.
import { isValidDate } from './visits.js';
import { dayNumber } from './days.js';
import { tripEndDate } from './itinerary.js';
import { t, tk } from './i18n.js';

export const DOCUMENT_KINDS = Object.freeze([
    { id: 'passport', icon: '🛂', label: tk('Passport') },
    { id: 'id_card', icon: '🪪', label: tk('ID card') },
    { id: 'visa', icon: '📄', label: tk('Visa') },
    { id: 'residence_permit', icon: '🏠', label: tk('Residence permit') },
    { id: 'other', icon: '📎', label: tk('Other document') }
]);
export const DOCUMENTS_MAX = 30;
// How long before expiry a document is flagged, and how long a passport should outlast a trip.
export const EXPIRY_WARN_DAYS = 90;
const PASSPORT_MARGIN_MONTHS = 6;

/** The kind of a document, as listed above. */
export const documentKind = id => DOCUMENT_KINDS.find(kind => kind.id === id) || DOCUMENT_KINDS.at(-1);

/** The date `months` calendar months after a YYYY-MM-DD date, kept within the month's days. */
export function addMonths(iso, months) {
    const [year, month, day] = iso.split('-').map(Number);
    const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month - 1 + months, Math.min(day, last))).toISOString().slice(0, 10);
}

/**
 * Whether a document is valid on `today`: `not_yet` before its first day, `expired` after its
 * last, `expiring` within 90 days of it, or `valid`; with the `days` left while it lasts.
 */
export function documentStatus(document, today) {
    if (document.validFrom && today < document.validFrom) return { state: 'not_yet' };
    const days = dayNumber(document.validUntil) - dayNumber(today);
    if (days < 0) return { state: 'expired' };
    return { state: days <= EXPIRY_WARN_DAYS ? 'expiring' : 'valid', days };
}

/**
 * What to check before the dated trips not over yet, as `{ trip, document, reason }`: a passport
 * that expires during the trip (`expires_during`) or within six months after it (`six_months`),
 * and a visa for one of the trip's countries (`countriesOf(trip)`) that does not cover its days
 * (`visa_gap`).
 */
export function tripDocumentWarnings(trips, documents, today, countriesOf) {
    const warnings = [];
    for (const trip of trips) {
        if (!trip.startDate) continue;
        const end = tripEndDate(trip);
        if (end < today) continue;
        const countries = new Set(countriesOf(trip));
        for (const document of documents) {
            if (document.kind === 'passport') {
                if (document.validUntil < end) warnings.push({ trip, document, reason: 'expires_during' });
                else if (document.validUntil < addMonths(end, PASSPORT_MARGIN_MONTHS)) warnings.push({ trip, document, reason: 'six_months' });
            } else if (document.kind === 'visa' && countries.has(document.country)) {
                if (document.validUntil < end || (document.validFrom && trip.startDate < document.validFrom)) warnings.push({ trip, document, reason: 'visa_gap' });
            }
        }
    }
    return warnings;
}

/** A document from the form, or what is wrong with it. `country` is a map code or null. */
export function checkDocument(values, country) {
    const document = {
        id: values.id, kind: values.kind, label: String(values.label || '').trim(), country: country || null,
        validFrom: values.validFrom || null, validUntil: values.validUntil || ''
    };
    if (!DOCUMENT_KINDS.some(kind => kind.id === document.kind)) return { error: t('Choose what kind of document it is.') };
    if (!document.label || document.label.length > 80) return { error: t('Name the document in 1 to 80 characters.') };
    if (!isValidDate(document.validUntil)) return { error: t('Choose the day the document expires.') };
    if (document.validFrom && !isValidDate(document.validFrom)) return { error: t('The first day is not a real date.') };
    if (document.validFrom && document.validUntil < document.validFrom) return { error: t('A travel document must expire on or after its first day.') };
    return { document };
}
