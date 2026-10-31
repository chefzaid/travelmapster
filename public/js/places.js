import { h, fill, toast, downloadFile, formatDate } from './ui.js';
import { CONTINENTS, CONTINENT_EMOJI, regionName } from './geo.js';
import { buildCsv, buildJson, parseImportContent, validatePlace, placeKey, mergePlaces } from './io.js';
import { lastVisitDate, lastVisitYears, matchesLastVisit, visitCount } from './visits.js';
import { groupByNextMonth, matchesDetails, monthsLabel, priorityLabel, ratingLabel, stars, usedTags } from './details.js';
import { STATUSES, statusLabel, statusOf } from './status.js';
import { openNewTrip } from './trips.js';
import { importButtons } from './import-apps.js';
import { t, tn } from './i18n.js';
import { openCountryList } from './country-list.js';

const view = { query: '', type: 'all', category: 'all', lastVisit: 'all', sort: 'continent' };

function matches(marker, country, filters) {
    if (view.type !== 'all' && statusOf(marker) !== view.type) return false;
    if (view.category !== 'all' && marker.category !== view.category) return false;
    if (!matchesLastVisit(marker, view.lastVisit)) return false;
    if (!matchesDetails(marker, filters)) return false;
    if (!view.query) return true;
    const visitNotes = (marker.visits || []).map(visit => visit.notes).join(' ');
    const tags = (marker.tags || []).map(tag => `#${tag}`).join(' ');
    const haystack = `${marker.name} ${country?.name || ''} ${marker.notes || ''} ${visitNotes} ${tags}`.toLowerCase();
    return haystack.includes(view.query.toLowerCase());
}

function visitSummary(marker) {
    const count = visitCount(marker);
    const last = lastVisitDate(marker);
    if (!count) return last ? ` · ${formatDate(last)}` : '';
    return ` · ${tn(count, '{count} visit, last {date}', '{count} visits, last {date}', { date: formatDate(last) })}`;
}

function chipGroup(label, key, options, onChange) {
    return h('div', { class: 'chip-group', role: 'group', 'aria-label': label },
        options.map(([value, text]) => h('button', {
            type: 'button',
            class: 'filter-chip',
            'aria-pressed': String(view[key] === value),
            onclick: () => {
                view[key] = value;
                onChange();
            }
        }, text))
    );
}

function placeItem(marker, country, ctx) {
    const tags = marker.tags || [];
    const status = statusOf(marker);
    return h('li', { class: `place place-${status}` },
        h('button', { type: 'button', class: 'place-main', onclick: () => ctx.showMarker(marker), title: t('Show on map') },
            // The traveler's emoji stands in for the flag or city pin.
            h('span', { class: 'place-flag', 'aria-hidden': 'true' }, marker.emoji || (marker.category === 'City' ? '📍' : country?.flag || '🏳️')),
            h('span', { class: 'place-text' },
                h('strong', {}, marker.name),
                h('small', {},
                    statusLabel(status),
                    visitSummary(marker),
                    marker.photoUrl || marker.visits?.some(visit => visit.photoUrl) ? ' · 📷' : '',
                    marker.hideFromPublic ? ` · ${t('🔒 Not on public map')}` : ''
                ),
                marker.type === 'wishlist' && (marker.priority || marker.bestMonths?.length) ? h('small', {},
                    [priorityLabel(marker.priority), marker.bestMonths?.length ? `Best ${monthsLabel(marker.bestMonths)}` : '']
                        .filter(Boolean).join(' · ')) : null,
                marker.rating ? h('small', { class: 'stars' },
                    h('span', { 'aria-hidden': 'true' }, stars(marker.rating)),
                    h('span', { class: 'visually-hidden' }, ratingLabel(marker.rating))) : null,
                tags.length ? h('span', { class: 'place-tags' }, tags.map(tag => `#${tag}`).join(' ')) : null,
                marker.notes ? h('span', { class: 'place-notes' }, marker.notes) : null
            )
        ),
        h('div', { class: 'place-actions' },
            status === 'wishlist' ? h('button', {
                type: 'button',
                class: 'icon-btn',
                'aria-label': t('Plan a trip to {name}', { name: marker.name }),
                title: t('Plan a trip'),
                onclick: () => openNewTrip(ctx, marker.name.split(',')[0])
            }, '🗓️') : null,
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Edit {name}', { name: marker.name }), title: t('Edit'), onclick: () => ctx.editPlace(marker) }, '✏️'),
            h('button', {
                type: 'button',
                class: 'icon-btn',
                'aria-label': t('Remove {name}', { name: marker.name }),
                title: t('Remove'),
                onclick: () => ctx.removePlace(marker).catch(ctx.handleError)
            }, '🗑️')
        )
    );
}

function sortMarkers(markers, ctx) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (view.sort === 'name') return [[t('All places'), [...markers].sort(byName)]];
    // The wishlist by the next month that suits each place (only wishlist places are listed).
    if (view.sort === 'season') return groupByNextMonth(markers, new Date().getMonth() + 1);
    if (view.sort === 'date') {
        const sorted = [...markers].sort((a, b) => lastVisitDate(b).localeCompare(lastVisitDate(a)) || byName(a, b));
        return [[t('Most recent visit first'), sorted]];
    }
    const groups = new Map([...CONTINENTS, 'Elsewhere'].map(name => [name, []]));
    for (const marker of markers) {
        const continent = ctx.state.stats.markerCountry.get(marker.id)?.continent;
        groups.get(groups.has(continent) ? continent : 'Elsewhere').push(marker);
    }
    return [...groups.entries()].filter(([, items]) => items.length).map(([name, items]) => [regionName(name), items.sort(byName)]);
}

function renderList(list, summary, ctx) {
    const { state } = ctx;
    const filtered = state.markers.filter(marker => matches(marker, state.stats.markerCountry.get(marker.id), state.filters)
        && (view.sort !== 'season' || marker.type === 'wishlist'));
    summary.textContent = tn(state.markers.length, '{shown} of {count} place', '{shown} of {count} places', { shown: filtered.length });
    if (!state.markers.length) {
        list.replaceChildren(h('div', { class: 'empty' },
            h('p', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🧳'),
            h('p', {}, t('No places yet. Click a country on the map to start your collection.'))
        ));
        return;
    }
    if (!filtered.length) {
        list.replaceChildren(h('div', { class: 'empty' }, h('p', {}, t('Nothing matches those filters.'))));
        return;
    }
    list.replaceChildren(...sortMarkers(filtered, ctx).map(([title, markers]) => h('section', { class: 'place-group' },
        h('h3', { class: 'section-title' }, title, h('span', { class: 'count' }, markers.length)),
        h('ul', { class: 'place-list' }, markers.map(marker => placeItem(marker, state.stats.markerCountry.get(marker.id), ctx)))
    )));
}

async function importFile(file, ctx, status) {
    try {
        const records = parseImportContent(file.name, await file.text());
        const existing = new Set(ctx.state.markers.map(placeKey));
        const valid = records.map(validatePlace).filter(Boolean);
        // CSV files hold one row per visit: rows of the same place count as one.
        const merged = mergePlaces(valid);
        let skipped = records.length - valid.length;
        const places = merged.filter(place => !existing.has(placeKey(place)));
        skipped += merged.length - places.length;
        status.textContent = tn(places.length, 'Importing {count} place…', 'Importing {count} places…');
        let imported = 0;
        if (places.length) {
            const result = await ctx.api.importMarkers(places);
            imported = result.imported;
            skipped += result.skipped;
        }
        await ctx.reloadMarkers();
        const message = skipped
            ? `${tn(imported, 'Imported {count} place', 'Imported {count} places')}, ${tn(skipped, 'skipped {count} invalid or duplicate', 'skipped {count} invalid or duplicate')}.`
            : `${tn(imported, 'Imported {count} place', 'Imported {count} places')}.`;
        status.textContent = message;
        toast(message, { tone: imported ? 'success' : 'info' });
    } catch (error) {
        status.textContent = error.message || t('Unable to import that file.');
    }
}

// The map formats are written by archive.js, loaded when first used.
const fromArchive = name => async markers => (await import('./archive.js'))[name](markers);

// Each export format: how to build the file, its media type and its name.
const EXPORTS = {
    json: [buildJson, 'application/json', 'JSON'],
    csv: [buildCsv, 'text/csv', 'CSV'],
    geojson: [fromArchive('buildGeoJson'), 'application/geo+json', 'GeoJSON'],
    kml: [fromArchive('buildKml'), 'application/vnd.google-earth.kml+xml', 'KML']
};

function dataSection(ctx) {
    const status = h('small', { class: 'muted', role: 'status', 'aria-live': 'polite' });
    const fileInput = h('input', {
        type: 'file',
        accept: '.json,.csv,application/json,text/csv',
        class: 'visually-hidden',
        id: 'import-file',
        onchange: event => {
            const [file] = event.target.files;
            if (file) importFile(file, ctx, status).finally(() => { event.target.value = ''; });
        }
    });
    const exportAs = async format => {
        const { markers } = ctx.state;
        if (!markers.length) {
            status.textContent = t('No saved places to export yet.');
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        const [build, type, label] = EXPORTS[format];
        downloadFile(`travelmapster-places-${date}.${format}`, await build(markers), type);
        status.textContent = tn(markers.length, 'Exported {count} place as {label}.', 'Exported {count} places as {label}.', { label });
    };
    return h('section', { class: 'data-section' },
        h('h3', { class: 'section-title' }, t('Backup & move your data')),
        h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exportAs('json') }, t('⬇️ JSON')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exportAs('csv') }, t('⬇️ CSV')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exportAs('geojson') }, t('⬇️ GeoJSON')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exportAs('kml') }, t('⬇️ KML')),
            h('label', { class: 'btn btn-ghost btn-sm', for: 'import-file' }, t('⬆️ Import')),
            fileInput
        ),
        h('p', { class: 'muted small' }, t('Coming from another app? Bring your trips from a Polarsteps data export, or paste your countries from Been, Visited or any list.')),
        h('div', { class: 'row' }, importButtons(ctx, status)),
        status
    );
}

// A whole continent in one step, or countries picked on the map; both can be undone.
function bulkSection(ctx) {
    const continent = h('select', { id: 'bulk-continent' },
        CONTINENTS.map(name => h('option', { value: name }, `${CONTINENT_EMOJI[name]} ${regionName(name)}`)));
    const mark = type => () => ctx.markContinent(continent.value, type);
    return h('section', { class: 'bulk-section', 'aria-labelledby': 'bulk-title' },
        h('h3', { class: 'section-title', id: 'bulk-title' }, t('Mark many at once')),
        h('div', { class: 'row' },
            h('label', { class: 'sort' }, t('Whole continent'), ' ', continent),
            h('button', { type: 'button', class: 'btn btn-sm btn-visited', onclick: mark('visited') }, t('✓ Been there')),
            h('button', { type: 'button', class: 'btn btn-sm btn-wishlist', onclick: mark('wishlist') }, t('♥ Wishlist'))
        ),
        h('button', { type: 'button', id: 'bulk-pick', class: 'btn btn-ghost btn-sm', onclick: () => ctx.startSelecting() }, t('☑️ Pick countries on the map')),
        h('p', { class: 'muted small' }, t('A wishlist never replaces a country you have been to.'))
    );
}

function lastVisitOptions(markers) {
    const years = lastVisitYears(markers);
    // Keep a chosen year selectable even after its last place is gone.
    if (/^\d{4}$/.test(view.lastVisit) && !years.includes(view.lastVisit)) years.push(view.lastVisit);
    return [['all', t('Any time')], ...years.map(year => [year, t('In {year}', { year })]), ['none', t('No date yet')]];
}

function tagOptions(markers, chosen) {
    const tags = usedTags(markers);
    // Keep a chosen tag selectable even after its last place is gone.
    if (chosen !== 'all' && !tags.includes(chosen)) tags.push(chosen);
    return [['all', t('Any tag')], ...tags.map(tag => [tag, `#${tag}`])];
}

const ratingFilters = () => [['all', t('Any rating')], ['5', t('★★★★★ only')], ['4', t('★★★★ and up')], ['3', t('★★★ and up')],
    ['2', t('★★ and up')], ['1', t('Rated')], ['none', t('Not rated')]];

// Tag and rating filters are shared with the map, so they live in the app state.
function detailFilters(ctx) {
    const { filters } = ctx.state;
    const select = (id, key, options) => h('select', { id, onchange: event => ctx.setDetailFilter({ [key]: event.target.value }) },
        options.map(([value, label]) => h('option', { value, selected: filters[key] === value }, label)));
    return h('div', { class: 'row sort-row' },
        h('label', { class: 'sort' }, t('Tag'), ' ', select('tag-filter', 'tag', tagOptions(ctx.state.markers, filters.tag))),
        h('label', { class: 'sort' }, t('Rating'), ' ', select('rating-filter', 'rating', ratingFilters())),
        h('small', { class: 'muted filter-note' }, t('Tag and rating filters apply to the map too.'))
    );
}

export function renderPlaces(container, ctx) {
    const list = h('div', { class: 'places' });
    const summary = h('p', { class: 'muted small', 'aria-live': 'polite' });
    const update = () => renderList(list, summary, ctx);
    const rerender = () => renderPlaces(container, ctx);

    const searchInput = h('input', {
        type: 'search',
        placeholder: t('Filter your places or notes…'),
        value: view.query,
        'aria-label': t('Filter your places'),
        oninput: event => {
            view.query = event.target.value;
            update();
        }
    });

    fill(container,
        h('div', { class: 'section-head' }, h('h2', {}, t('Your places')), summary),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => openCountryList(ctx) }, t('🗂️ Countries as a list')),
        h('div', { class: 'filters' },
            searchInput,
            chipGroup(t('Status'), 'type', [['all', t('All')], ...STATUSES.map(({ id, filter }) => [id, filter])], rerender),
            chipGroup(t('Kind'), 'category', [['all', t('All')], ['Country', t('Countries')], ['City', t('Cities')]], rerender),
            h('div', { class: 'row sort-row' },
                h('label', { class: 'sort' }, t('Sort by'), ' ',
                    h('select', { id: 'places-sort', onchange: event => { view.sort = event.target.value; update(); } },
                        [['continent', t('Continent')], ['name', t('Name')], ['date', t('Last visit')], ['season', t('When to go (wishlist)')]].map(([value, label]) =>
                            h('option', { value, selected: view.sort === value }, label)))
                ),
                h('label', { class: 'sort' }, t('Last visit'), ' ',
                    h('select', { id: 'last-visit-filter', onchange: event => { view.lastVisit = event.target.value; update(); } },
                        lastVisitOptions(ctx.state.markers).map(([value, label]) =>
                            h('option', { value, selected: view.lastVisit === value }, label)))
                )
            ),
            detailFilters(ctx)
        ),
        list,
        bulkSection(ctx),
        dataSection(ctx)
    );
    update();
}
