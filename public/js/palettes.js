// Map palettes (ADR 0016): the colours live in css/tokens.css as token overrides under
// `html[data-palette]`, so the map, the legend and the chips change together. Pure, unit tested
// in Node, where the tests also check each palette's contrast and colour-blind safety.

export const PALETTES = [
    { id: 'standard', label: 'Cheerful (standard)' },
    { id: 'colorblind', label: 'Color-blind safe' },
    { id: 'print', label: 'Print-friendly' }
];

export const DEFAULT_PALETTE = 'standard';

/** A known palette id, or the standard one. */
export function paletteId(value) {
    return PALETTES.some(palette => palette.id === value) ? value : DEFAULT_PALETTE;
}
