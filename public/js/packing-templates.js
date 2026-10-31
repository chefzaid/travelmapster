// Packing list templates: ready-made lists for common kinds of trip, and the traveler's own,
// saved on the account to start a new trip's list from. Pure, unit tested in Node.
import { t, tk } from './i18n.js';
import { PACKING_MAX_ITEMS, STARTER_PACKING } from './trip-budget.js';

export const TEMPLATES_MAX = 20;
export const TEMPLATE_NAME_MAX = 40;

const READY_MADE = [
    { id: 'basics', name: tk('The basics'), items: STARTER_PACKING },
    {
        id: 'beach', name: tk('Beach'),
        items: [tk('Swimsuit'), tk('Sunscreen'), tk('Sunglasses'), tk('Sun hat'), tk('Beach towel'), tk('Sandals'), tk('After-sun lotion'), tk('Water bottle')]
    },
    {
        id: 'city', name: tk('City'),
        items: [tk('Comfortable shoes'), tk('Day bag'), tk('Power bank'), tk('Umbrella'), tk('Offline maps'), tk('Water bottle'), tk('Something smart for the evening')]
    },
    {
        id: 'business', name: tk('Business'),
        items: [tk('Laptop and charger'), tk('Work clothes'), tk('Business cards'), tk('Letter from your employer'), tk('Notebook and pen'), tk('Screen adapter')]
    },
    {
        id: 'ski', name: tk('Ski'),
        items: [tk('Ski jacket and trousers'), tk('Thermal layers'), tk('Gloves'), tk('Warm hat'), tk('Ski goggles'), tk('Ski socks'), tk('Lip balm with sun protection'), tk('Ski pass')]
    }
];

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * Every template to start from: the ready-made ones in the current language, then the
 * traveler's own. Each has a `key` unique among them and its `items`.
 */
export function packingTemplates(saved = []) {
    return [
        ...READY_MADE.map(template => ({ key: template.id, name: t(template.name), items: template.items.map(item => t(item)), own: false })),
        ...saved.map(template => ({ key: `own:${template.name}`, name: template.name, items: template.items, own: true }))
    ];
}

/** A template from a trip's packing list: its items once each (without case), none packed. */
export function templateFrom(name, packing = []) {
    const items = [];
    for (const { item } of packing) if (!items.some(known => same(known, item))) items.push(item);
    return { name: name.trim().slice(0, TEMPLATE_NAME_MAX), items: items.slice(0, PACKING_MAX_ITEMS) };
}

/**
 * The saved templates with this one added, or in place of the one of the same name (without
 * case); `replaced` tells which. Null when the list is full and the name is new.
 */
export function withTemplate(saved = [], template) {
    const at = saved.findIndex(known => same(known.name, template.name));
    if (at >= 0) return { templates: saved.map((known, i) => (i === at ? template : known)), replaced: true };
    if (saved.length >= TEMPLATES_MAX) return null;
    return { templates: [...saved, template], replaced: false };
}

/** The saved templates without the one of this name. */
export const withoutTemplate = (saved = [], name) => saved.filter(known => !same(known.name, name));
