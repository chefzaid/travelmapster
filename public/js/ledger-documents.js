// Ledger tab, "Travel documents": passports, ID cards, visas and residence permits with their
// validity, a warning before each expires, and the trips ahead they do not cover well enough
// (documents.js). Names and dates only, never a document's number.
import { h, toast, formDialog, formatDate } from './ui.js';
import { DOCUMENTS_MAX, DOCUMENT_KINDS, checkDocument, documentKind, documentStatus, tripDocumentWarnings } from './documents.js';
import { newId } from './ledger-rules.js';
import { countryLabel } from './ledger-parts.js';
import { countryName } from './ledger-report.js';
import { tripStops } from './itinerary.js';
import { destinationPlace } from './trip-visits.js';
import { localToday } from './days.js';
import { t, tn } from './i18n.js';

const documentsOf = ctx => ctx.state.ledger.settings.documents || [];

async function save(ctx, documents) {
    try {
        await ctx.saveLedger({ ...ctx.state.ledger.settings, documents });
        return true;
    } catch (error) {
        ctx.handleError(error);
        return false;
    }
}

async function documentDialog(ctx, document) {
    let draft = document ? { ...document, country: document.country ? countryName(ctx, document.country) : '' } : { kind: 'passport', label: '', country: '', validFrom: '', validUntil: '' };
    for (;;) {
        const values = await formDialog({
            title: document ? t('Edit {name}', { name: document.label }) : t('Add a travel document'),
            message: t('Names and dates only: never enter a document\'s number, which TravelMapster does not need.'),
            submitLabel: document ? t('Save document') : t('Add document'),
            fields: [
                { name: 'kind', label: t('Kind'), type: 'select', value: draft.kind, options: DOCUMENT_KINDS.map(kind => ({ value: kind.id, label: `${kind.icon} ${t(kind.label)}` })) },
                { name: 'label', label: t('Name'), value: draft.label, required: true, maxlength: 80, placeholder: t('My passport') },
                { name: 'country', label: t('Country'), value: draft.country, hint: t('Optional: the country that issued it, or the one a visa is for.') },
                { name: 'validFrom', label: t('Valid from'), type: 'date', value: draft.validFrom || '', hint: t('Optional.') },
                { name: 'validUntil', label: t('Expires on'), type: 'date', value: draft.validUntil, required: true }
            ]
        });
        if (!values) return null;
        const name = values.country.trim();
        const country = name ? ctx.state.index.findByName(name) || ctx.state.index.byId.get(name.toUpperCase()) : null;
        const { document: checked, error } = name && !country
            ? { error: tn(1, 'Unknown country: {names}.', 'Unknown countries: {names}.', { names: name }) }
            : checkDocument({ ...values, id: document?.id || newId() }, country?.id);
        if (!error) return checked;
        toast(error, { tone: 'error' });
        draft = values;
    }
}

function statusLine(document, today) {
    const status = documentStatus(document, today);
    if (status.state === 'not_yet') return { tone: 'is-later', text: t('Valid from {date}', { date: formatDate(document.validFrom) }) };
    if (status.state === 'expired') return { tone: 'is-over', text: t('Expired on {date}', { date: formatDate(document.validUntil) }) };
    if (status.state === 'expiring') return { tone: 'is-near', text: tn(status.days, 'Expires in {count} day, on {date}', 'Expires in {count} days, on {date}', { date: formatDate(document.validUntil) }) };
    return { tone: 'is-ok', text: t('Valid until {date}', { date: formatDate(document.validUntil) }) };
}

function documentItem(ctx, document, today) {
    const documents = documentsOf(ctx);
    const edit = async () => {
        const updated = await documentDialog(ctx, document);
        if (updated && await save(ctx, documents.map(item => (item.id === document.id ? updated : item)))) toast(t('Document saved.'), { tone: 'success' });
    };
    const remove = async () => {
        if (await save(ctx, documents.filter(item => item.id !== document.id))) {
            toast(t('Removed {name}.', { name: document.label }), { action: { label: t('Undo'), run: () => save(ctx, [...documentsOf(ctx), document]) } });
        }
    };
    const kind = documentKind(document.kind);
    const status = statusLine(document, today);
    return h('li', { class: 'ledger-item' },
        h('span', { class: 'ledger-item-text' },
            h('strong', {}, h('span', { 'aria-hidden': 'true' }, `${kind.icon} `), document.label),
            h('small', {}, [t(kind.label), document.country ? countryLabel(ctx, document.country) : null].filter(Boolean).join(' · ')),
            h('small', { class: `document-status ${status.tone}` }, status.text)),
        h('span', { class: 'ledger-item-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Edit {name}', { name: document.label }), title: t('Edit'), onclick: edit }, '✏️'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove {name}', { name: document.label }), title: t('Remove'), onclick: remove }, '🗑️')));
}

function warningText({ trip, document, reason }) {
    const values = { trip: trip.title, name: document.label, date: formatDate(document.validUntil) };
    if (reason === 'expires_during') return t('{trip}: {name} expires on {date}, before the trip ends.', values);
    if (reason === 'six_months') return t('{trip}: {name} expires on {date}, less than six months after the trip. Many countries ask for six months.', values);
    return t('{trip}: {name} does not cover every day of the trip.', values);
}

export function documentsSection(ctx) {
    const documents = [...documentsOf(ctx)].sort((a, b) => a.validUntil.localeCompare(b.validUntil));
    const today = localToday();
    const countriesOf = trip => tripStops(trip).map(stop => destinationPlace(ctx, stop.destination)?.countryId).filter(Boolean);
    const warnings = tripDocumentWarnings(ctx.state.trips || [], documents, today, countriesOf);
    const add = async () => {
        if (documents.length >= DOCUMENTS_MAX) {
            toast(t('You can keep up to {DOCUMENTS_MAX} documents. Remove one first.', { DOCUMENTS_MAX }), { tone: 'error' });
            return;
        }
        const document = await documentDialog(ctx);
        if (document && await save(ctx, [...documentsOf(ctx), document])) toast(t('Added {name}.', { name: document.label }), { tone: 'success' });
    };
    return h('section', { 'aria-labelledby': 'documents-title' },
        h('h3', { class: 'section-title', id: 'documents-title' }, t('🛂 Travel documents'), h('span', { class: 'count' }, documents.length)),
        warnings.length ? h('ul', { class: 'document-warnings', id: 'document-warnings' }, warnings.map(warning => h('li', {}, h('span', { 'aria-hidden': 'true' }, '⚠️ '), warningText(warning)))) : null,
        documents.length
            ? h('ul', { class: 'ledger-list', id: 'documents-list' }, documents.map(document => documentItem(ctx, document, today)))
            : h('p', { class: 'muted small' }, t('Add your passport, ID card, visas and permits with their dates: you are warned before one expires, and when a trip ahead needs a passport valid longer.')),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: add }, t('＋ Add a document')));
}
