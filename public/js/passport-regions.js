// The passport's regions: for the largest countries, how many of their states, provinces and
// regions a town been to lies in (regions.js). The region outlines
// (public/data/regions.geojson) load only once the section is first drawn.
import { h, fill } from './ui.js';
import { regionIndex, regionProgress } from './regions.js';
import { formatList, locale, t } from './i18n.js';

let indexPromise = null;

const loadRegions = () => {
    indexPromise ||= fetch(new URL('../data/regions.geojson', import.meta.url)).then(res => res.json()).then(geojson => regionIndex(geojson, locale()));
    return indexPromise;
};

function draw(ctx, body, index) {
    const { stats } = ctx.state;
    const progress = regionProgress(index, ctx.state.markers, marker => stats.markerCountry.get(marker.id)?.id);
    const countryName = id => ctx.state.index.byId.get(id)?.name || id;
    const flag = id => ctx.state.index.byId.get(id)?.flag || '';
    if (!progress.length) {
        const covered = formatList([...index.byCountry.keys()].map(countryName).sort((a, b) => a.localeCompare(b, locale())));
        fill(body, h('p', { class: 'muted small' }, t('Mark a town you have been to in {countries} to count their states, provinces and regions.', { countries: covered })));
        return;
    }
    fill(body, h('ul', { class: 'region-list' }, progress.map(({ countryId, total, visited }) => h('li', {},
        h('strong', {}, h('span', { 'aria-hidden': 'true' }, `${flag(countryId)} `), t('{country}: {visited} of {total}', { country: countryName(countryId), visited: visited.length, total })),
        h('small', {}, formatList(visited.map(({ region, towns }) => t('{region} ({towns})', { region: region.name, towns: formatList(towns) }))))))));
}

/** The regions section; the outlines load once, the first time it is drawn. */
export function regionsSection(ctx) {
    const body = h('div', {}, h('p', { class: 'muted small' }, t('Loading…')));
    loadRegions()
        .then(index => draw(ctx, body, index))
        .catch(() => fill(body, h('p', { class: 'muted small' }, t('The regions could not be loaded.'))));
    return h('section', { 'aria-labelledby': 'regions-title' },
        h('h3', { class: 'section-title', id: 'regions-title' }, t('🗺️ States and provinces')), body);
}
