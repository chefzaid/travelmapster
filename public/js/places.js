import { h, fill, toast, downloadFile, formatDate } from './ui.js';
import { CONTINENTS } from './geo.js';
import { buildCsv, buildJson, parseImportContent, validatePlace, placeKey, mergePlaces } from './io.js';
import { lastVisitDate, lastVisitYears, matchesLastVisit, visitCount } from './visits.js';
import { matchesDetails, ratingLabel, stars, usedTags } from './details.js';

const view = { query: '', type: 'all', category: 'all', lastVisit: 'all', sort: 'continent' };

function matches(marker, country, filters) {
    if (view.type !== 'all' && marker.type !== view.type) return false;
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
    const times = count === 1 ? '1 visit' : `${count} visits`;
    return ` · ${times}, last ${formatDate(last)}`;
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
    return h('li', { class: `place place-${marker.type}` },
        h('button', { type: 'button', class: 'place-main', onclick: () => ctx.showMarker(marker), title: 'Show on map' },
            // The traveler's emoji stands in for the flag or city pin.
            h('span', { class: 'place-flag', 'aria-hidden': 'true' }, marker.emoji || (marker.category === 'City' ? '📍' : country?.flag || '🏳️')),
            h('span', { class: 'place-text' },
                h('strong', {}, marker.name),
                h('small', {},
                    marker.type === 'visited' ? '✓ Been there' : '♥ Wishlist',
                    visitSummary(marker),
                    marker.photoUrl || marker.visits?.some(visit => visit.photoUrl) ? ' · 📷' : '',
                    marker.hideFromPublic ? ' · 🔒 Not on public map' : ''
                ),
                marker.rating ? h('small', { class: 'stars' },
                    h('span', { 'aria-hidden': 'true' }, stars(marker.rating)),
                    h('span', { class: 'visually-hidden' }, ratingLabel(marker.rating))) : null,
                tags.length ? h('span', { class: 'place-tags' }, tags.map(tag => `#${tag}`).join(' ')) : null,
                marker.notes ? h('span', { class: 'place-notes' }, marker.notes) : null
            )
        ),
        h('div', { class: 'place-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${marker.name}`, title: 'Edit', onclick: () => ctx.editPlace(marker) }, '✏️'),
            h('button', {
                type: 'button',
                class: 'icon-btn',
                'aria-label': `Remove ${marker.name}`,
                title: 'Remove',
                onclick: () => ctx.removePlace(marker).catch(ctx.handleError)
            }, '🗑️')
        )
    );
}

function sortMarkers(markers, ctx) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (view.sort === 'name') return [['All places', [...markers].sort(byName)]];
    if (view.sort === 'date') {
        const sorted = [...markers].sort((a, b) => lastVisitDate(b).localeCompare(lastVisitDate(a)) || byName(a, b));
        return [['Most recent visit first', sorted]];
    }
    const groups = new Map([...CONTINENTS, 'Elsewhere'].map(name => [name, []]));
    for (const marker of markers) {
        const continent = ctx.state.stats.markerCountry.get(marker.id)?.continent;
        groups.get(groups.has(continent) ? continent : 'Elsewhere').push(marker);
    }
    return [...groups.entries()].filter(([, items]) => items.length).map(([name, items]) => [name, items.sort(byName)]);
}

function renderList(list, summary, ctx) {
    const { state } = ctx;
    const filtered = state.markers.filter(marker => matches(marker, state.stats.markerCountry.get(marker.id), state.filters));
    summary.textContent = `${filtered.length} of ${state.markers.length} places`;
    if (!state.markers.length) {
        list.replaceChildren(h('div', { class: 'empty' },
            h('p', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🧳'),
            h('p', {}, 'No places yet. Click a country on the map to start your collection.')
        ));
        return;
    }
    if (!filtered.length) {
        list.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Nothing matches those filters.')));
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
        status.textContent = `Importing ${places.length} ${places.length === 1 ? 'place' : 'places'}…`;
        let imported = 0;
        if (places.length) {
            const result = await ctx.api.importMarkers(places);
            imported = result.imported;
            skipped += result.skipped;
        }
        await ctx.reloadMarkers();
        const message = `Imported ${imported} ${imported === 1 ? 'place' : 'places'}${skipped ? `, skipped ${skipped} invalid or duplicate` : ''}.`;
        status.textContent = message;
        toast(message, { tone: imported ? 'success' : 'info' });
    } catch (error) {
        status.textContent = error.message || 'Unable to import that file.';
    }
}

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
    const exportAs = format => {
        const { markers } = ctx.state;
        if (!markers.length) {
            status.textContent = 'No saved places to export yet.';
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        if (format === 'csv') downloadFile(`travelmapster-places-${date}.csv`, buildCsv(markers), 'text/csv');
        else downloadFile(`travelmapster-places-${date}.json`, buildJson(markers), 'application/json');
        status.textContent = `Exported ${markers.length} places as ${format.toUpperCase()}.`;
    };
    return h('section', { class: 'data-section' },
        h('h3', { class: 'section-title' }, 'Backup & move your data'),
        h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exportAs('json') }, '⬇️ JSON'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exportAs('csv') }, '⬇️ CSV'),
            h('label', { class: 'btn btn-ghost btn-sm', for: 'import-file' }, '⬆️ Import'),
            fileInput
        ),
        status
    );
}

function lastVisitOptions(markers) {
    const years = lastVisitYears(markers);
    // Keep a chosen year selectable even after its last place is gone.
    if (/^\d{4}$/.test(view.lastVisit) && !years.includes(view.lastVisit)) years.push(view.lastVisit);
    return [['all', 'Any time'], ...years.map(year => [year, `In ${year}`]), ['none', 'No date yet']];
}

function tagOptions(markers, chosen) {
    const tags = usedTags(markers);
    // Keep a chosen tag selectable even after its last place is gone.
    if (chosen !== 'all' && !tags.includes(chosen)) tags.push(chosen);
    return [['all', 'Any tag'], ...tags.map(tag => [tag, `#${tag}`])];
}

const RATING_FILTERS = [['all', 'Any rating'], ['5', '★★★★★ only'], ['4', '★★★★ and up'], ['3', '★★★ and up'],
    ['2', '★★ and up'], ['1', 'Rated'], ['none', 'Not rated']];

// Tag and rating filters are shared with the map, so they live in the app state.
function detailFilters(ctx) {
    const { filters } = ctx.state;
    const select = (id, key, options) => h('select', { id, onchange: event => ctx.setDetailFilter({ [key]: event.target.value }) },
        options.map(([value, label]) => h('option', { value, selected: filters[key] === value }, label)));
    return h('div', { class: 'row sort-row' },
        h('label', { class: 'sort' }, 'Tag ', select('tag-filter', 'tag', tagOptions(ctx.state.markers, filters.tag))),
        h('label', { class: 'sort' }, 'Rating ', select('rating-filter', 'rating', RATING_FILTERS)),
        h('small', { class: 'muted filter-note' }, 'Tag and rating filters apply to the map too.')
    );
}

export function renderPlaces(container, ctx) {
    const list = h('div', { class: 'places' });
    const summary = h('p', { class: 'muted small', 'aria-live': 'polite' });
    const update = () => renderList(list, summary, ctx);
    const rerender = () => renderPlaces(container, ctx);

    const searchInput = h('input', {
        type: 'search',
        placeholder: 'Filter your places or notes…',
        value: view.query,
        'aria-label': 'Filter your places',
        oninput: event => {
            view.query = event.target.value;
            update();
        }
    });

    fill(container,
        h('div', { class: 'section-head' }, h('h2', {}, 'Your places'), summary),
        h('div', { class: 'filters' },
            searchInput,
            chipGroup('Status', 'type', [['all', 'All'], ['visited', '✓ Been'], ['wishlist', '♥ Wish']], rerender),
            chipGroup('Kind', 'category', [['all', 'All'], ['Country', 'Countries'], ['City', 'Cities']], rerender),
            h('div', { class: 'row sort-row' },
                h('label', { class: 'sort' }, 'Sort by ',
                    h('select', { onchange: event => { view.sort = event.target.value; update(); } },
                        [['continent', 'Continent'], ['name', 'Name'], ['date', 'Last visit']].map(([value, label]) =>
                            h('option', { value, selected: view.sort === value }, label)))
                ),
                h('label', { class: 'sort' }, 'Last visit ',
                    h('select', { id: 'last-visit-filter', onchange: event => { view.lastVisit = event.target.value; update(); } },
                        lastVisitOptions(ctx.state.markers).map(([value, label]) =>
                            h('option', { value, selected: view.lastVisit === value }, label)))
                )
            ),
            detailFilters(ctx)
        ),
        list,
        dataSection(ctx)
    );
    update();
}
