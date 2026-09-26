import { h, fill, toast, downloadFile, formatDate } from './ui.js';
import { CONTINENTS } from './geo.js';
import { buildCsv, parseImportContent, validatePlace, placeKey } from './io.js';

const view = { query: '', type: 'all', category: 'all', sort: 'continent' };

function matches(marker, country) {
    if (view.type !== 'all' && marker.type !== view.type) return false;
    if (view.category !== 'all' && marker.category !== view.category) return false;
    if (!view.query) return true;
    const haystack = `${marker.name} ${country?.name || ''} ${marker.notes || ''}`.toLowerCase();
    return haystack.includes(view.query.toLowerCase());
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
    return h('li', { class: `place place-${marker.type}` },
        h('button', { type: 'button', class: 'place-main', onclick: () => ctx.showMarker(marker), title: 'Show on map' },
            h('span', { class: 'place-flag', 'aria-hidden': 'true' }, marker.category === 'City' ? '📍' : country?.flag || '🏳️'),
            h('span', { class: 'place-text' },
                h('strong', {}, marker.name),
                h('small', {},
                    marker.type === 'visited' ? '✓ Been there' : '♥ Wishlist',
                    marker.travelDate ? ` · ${formatDate(marker.travelDate)}` : '',
                    marker.photoUrl ? ' · 📷' : ''
                ),
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
        const sorted = [...markers].sort((a, b) => (b.travelDate || '').localeCompare(a.travelDate || '') || byName(a, b));
        return [['Newest trips first', sorted]];
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
    const filtered = state.markers.filter(marker => matches(marker, state.stats.markerCountry.get(marker.id)));
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
        const places = [];
        let skipped = 0;
        for (const record of records) {
            const place = validatePlace(record);
            if (!place || existing.has(placeKey(place))) {
                skipped += 1;
                continue;
            }
            existing.add(placeKey(place));
            places.push(place);
        }
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
        else downloadFile(`travelmapster-places-${date}.json`, JSON.stringify(markers, null, 2), 'application/json');
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
            h('label', { class: 'sort' }, 'Sort by ',
                h('select', { onchange: event => { view.sort = event.target.value; update(); } },
                    [['continent', 'Continent'], ['name', 'Name'], ['date', 'Travel date']].map(([value, label]) =>
                        h('option', { value, selected: view.sort === value }, label)))
            )
        ),
        list,
        dataSection(ctx)
    );
    update();
}
