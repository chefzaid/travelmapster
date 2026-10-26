// The form that edits a saved place: name, status, wishlist plans, rating, emoji, tags, notes,
// photo link and whether it is hidden from the public map (ADR 0012, 0013, 0014).
import { toast, formDialog } from './ui.js';
import { EMOJI_CHOICES, PRIORITIES, monthName, checkDetails, knownTags, parseRating, splitTags } from './details.js';
import { STATUSES, statusFields, statusLabel, statusOf } from './status.js';
import { t } from './i18n.js';

const RATING_OPTIONS = [
    { value: '', get label() { return t('Not rated'); } },
    { value: '1', get label() { return t('★ 1 · Not for me'); } },
    { value: '2', get label() { return t('★★ 2 · It was OK'); } },
    { value: '3', get label() { return t('★★★ 3 · Good'); } },
    { value: '4', get label() { return t('★★★★ 4 · Great'); } },
    { value: '5', get label() { return t('★★★★★ 5 · Loved it'); } }
];

function placeFormFields(markers, draft) {
    // The suggested tags and the traveler's most used ones, plus any this place already has.
    const tagOptions = [...new Set([...knownTags(markers).slice(0, 16), ...draft.tags])];
    return [
        { name: 'name', label: t('Name'), value: draft.name, required: true, maxlength: 160 },
        { name: 'status', label: t('Status'), type: 'select', value: draft.status || statusOf(draft),
            options: STATUSES.map(({ id }) => ({ value: id, label: statusLabel(id) })),
            hint: t('Transit only is for layovers: the country is not counted as visited, but dated days still count in the ledger.') },
        { name: 'priority', label: t('Wishlist priority'), type: 'select', value: draft.priority || '',
            options: [{ value: '', label: t('No priority') }, ...PRIORITIES] },
        { name: 'bestMonths', label: t('Best months to go'), type: 'choices', value: (draft.bestMonths || []).map(String),
            options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1, 'short') })),
            hint: t('The wishlist sorts places by the next of these months.') },
        { name: 'rating', label: t('Rating'), type: 'select', value: draft.rating ? String(draft.rating) : '', options: RATING_OPTIONS },
        { name: 'emoji', label: t('Pin emoji'), type: 'picker', value: draft.emoji || '', maxlength: 32, placeholder: t('Type or paste one emoji'),
            choices: EMOJI_CHOICES, choicesLabel: t('Quick emoji'), hint: t('Shown on the city pin and in your list.') },
        { name: 'tags', label: t('Tags'), type: 'choices', value: draft.tags, options: tagOptions.map(tag => ({ value: tag, label: `#${tag}` })) },
        { name: 'otherTags', label: t('Other tags'), value: draft.otherTags || '', maxlength: 200, placeholder: t('street art, road trip'),
            hint: t('Separate tags with commas; at most 8 per place.') },
        { name: 'notes', label: t('Notes about this place'), type: 'textarea', value: draft.notes || '', maxlength: 2000, placeholder: t('Why you love it, tips, what to try…') },
        { name: 'photoUrl', label: t('Photo link'), type: 'url', value: draft.photoUrl || '', placeholder: 'https://…', hint: t('Link to a photo hosted anywhere (HTTP or HTTPS). Dates go on each visit.') },
        { name: 'hideFromPublic', label: t('Hide from my public map'), type: 'checkbox', value: draft.hideFromPublic,
            hint: t('Visitors of your shared map will not see this place or its visits.') }
    ];
}

// A mistake reopens the form with what was typed, like the visit form.
export async function editPlace(ctx, marker) {
    let draft = { ...marker, tags: marker.tags || [] };
    for (;;) {
        const values = await formDialog({ title: t('Edit {name}', { name: marker.name }), submitLabel: t('Save changes'), fields: placeFormFields(ctx.state.markers, draft) });
        if (!values) return;
        const { details, error } = checkDetails({
            ...values, tags: [...values.tags, ...splitTags(values.otherTags)]
        });
        if (error) {
            toast(error, { tone: 'error' });
            draft = {
                ...draft, ...values, rating: parseRating(values.rating) ?? null, hideFromPublic: values.hideFromPublic === 'on',
                bestMonths: values.bestMonths.map(Number)
            };
            continue;
        }
        try {
            await ctx.updatePlace(marker, {
                name: values.name.trim(),
                ...statusFields(values.status),
                notes: values.notes.trim(),
                photoUrl: values.photoUrl.trim(),
                hideFromPublic: values.hideFromPublic === 'on',
                ...details
            });
            toast(t('Saved {name}.', { name: marker.name }), { tone: 'success' });
            ctx.map.closePopup();
        } catch (error) {
            ctx.handleError(error);
        }
        return;
    }
}
