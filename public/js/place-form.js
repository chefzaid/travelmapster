// The form that edits a saved place: name, status, wishlist plans, rating, emoji, tags, notes,
// photo link and whether it is hidden from the public map (ADR 0012, 0013, 0014).
import { toast, formDialog } from './ui.js';
import { EMOJI_CHOICES, MONTH_NAMES, PRIORITIES, checkDetails, knownTags, parseRating, splitTags } from './details.js';
import { STATUSES, statusFields, statusLabel, statusOf } from './status.js';

const RATING_OPTIONS = [
    { value: '', label: 'Not rated' },
    { value: '1', label: '★ 1 · Not for me' },
    { value: '2', label: '★★ 2 · It was OK' },
    { value: '3', label: '★★★ 3 · Good' },
    { value: '4', label: '★★★★ 4 · Great' },
    { value: '5', label: '★★★★★ 5 · Loved it' }
];

function placeFormFields(markers, draft) {
    // The suggested tags and the traveler's most used ones, plus any this place already has.
    const tagOptions = [...new Set([...knownTags(markers).slice(0, 16), ...draft.tags])];
    return [
        { name: 'name', label: 'Name', value: draft.name, required: true, maxlength: 160 },
        { name: 'status', label: 'Status', type: 'select', value: draft.status || statusOf(draft),
            options: STATUSES.map(({ id }) => ({ value: id, label: statusLabel(id) })),
            hint: 'Transit only is for layovers: the country is not counted as visited, but dated days still count in the ledger.' },
        { name: 'priority', label: 'Wishlist priority', type: 'select', value: draft.priority || '',
            options: [{ value: '', label: 'No priority' }, ...PRIORITIES] },
        { name: 'bestMonths', label: 'Best months to go', type: 'choices', value: (draft.bestMonths || []).map(String),
            options: MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name.slice(0, 3) })),
            hint: 'The wishlist sorts places by the next of these months.' },
        { name: 'rating', label: 'Rating', type: 'select', value: draft.rating ? String(draft.rating) : '', options: RATING_OPTIONS },
        { name: 'emoji', label: 'Pin emoji', type: 'picker', value: draft.emoji || '', maxlength: 32, placeholder: 'Type or paste one emoji',
            choices: EMOJI_CHOICES, choicesLabel: 'Quick emoji', hint: 'Shown on the city pin and in your list.' },
        { name: 'tags', label: 'Tags', type: 'choices', value: draft.tags, options: tagOptions.map(tag => ({ value: tag, label: `#${tag}` })) },
        { name: 'otherTags', label: 'Other tags', value: draft.otherTags || '', maxlength: 200, placeholder: 'street art, road trip',
            hint: 'Separate tags with commas; at most 8 per place.' },
        { name: 'notes', label: 'Notes about this place', type: 'textarea', value: draft.notes || '', maxlength: 2000, placeholder: 'Why you love it, tips, what to try…' },
        { name: 'photoUrl', label: 'Photo link', type: 'url', value: draft.photoUrl || '', placeholder: 'https://…', hint: 'Link to a photo hosted anywhere (HTTP or HTTPS). Dates go on each visit.' },
        { name: 'hideFromPublic', label: 'Hide from my public map', type: 'checkbox', value: draft.hideFromPublic,
            hint: 'Visitors of your shared map will not see this place or its visits.' }
    ];
}

// A mistake reopens the form with what was typed, like the visit form.
export async function editPlace(ctx, marker) {
    let draft = { ...marker, tags: marker.tags || [] };
    for (;;) {
        const values = await formDialog({ title: `Edit ${marker.name}`, submitLabel: 'Save changes', fields: placeFormFields(ctx.state.markers, draft) });
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
            toast(`Saved ${marker.name}.`, { tone: 'success' });
            ctx.map.closePopup();
        } catch (error) {
            ctx.handleError(error);
        }
        return;
    }
}
