// Importing from other travel apps, with a preview: a Polarsteps data export (its ZIP, or the
// trip.json files in it) or a pasted list of countries from Been, Visited and other atlases.
// The places are read in imports.js; nothing is saved until the traveler confirms.
import { h, toast, formDialog } from './ui.js';
import { placeKey } from './io.js';
import { countryListPlaces, polarstepsPlaces, polarstepsTripEntries } from './imports.js';
import { readZipText, zipEntries } from './zip-read.js';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// The trips in the chosen files: a whole export as a ZIP, or trip.json files.
async function polarstepsTrips(files) {
    const trips = [];
    for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
            for (const entry of polarstepsTripEntries(await zipEntries(file))) trips.push(JSON.parse(await readZipText(file, entry)));
        } else {
            trips.push(JSON.parse(await file.text()));
        }
    }
    if (!trips.length) throw new Error('No Polarsteps trips were found. Choose the ZIP file from “Download my data”, or the trip.json files in it.');
    return trips;
}

// Merges places from several trips: the same place gathers every visit.
function mergeByName(places) {
    const merged = new Map();
    for (const place of places) {
        const key = placeKey(place);
        if (merged.has(key)) merged.get(key).visits.push(...place.visits);
        else merged.set(key, { ...place, visits: [...place.visits] });
    }
    return [...merged.values()];
}

/**
 * Shows the places found, all ticked; saves the ticked ones. New places are imported with their
 * visits; places already on the map get the visits they do not have yet.
 */
async function previewAndImport(ctx, found, status, note = '') {
    if (!found.length) {
        status.textContent = `Nothing to import.${note ? ` ${note}` : ''}`;
        return;
    }
    const byKey = new Map(ctx.state.markers.map(marker => [placeKey(marker), marker]));
    const visits = found.reduce((sum, place) => sum + place.visits.length, 0);
    const values = await formDialog({
        title: 'Import these places?',
        message: `${plural(found.length, 'place', 'places')}${visits ? ` with ${plural(visits, 'visit', 'visits')}` : ''}. `
            + `Untick any you do not want; places already on your map only get the visits they lack.${note ? ` ${note}` : ''}`,
        submitLabel: 'Import',
        fields: [{
            name: 'places', label: 'Places', type: 'choices', value: found.map(placeKey),
            options: found.map(place => ({ value: placeKey(place), label: `${place.name}${byKey.has(placeKey(place)) ? ' (on your map)' : ''}` }))
        }]
    });
    if (!values) return;
    const chosen = new Set(values.places);
    const picked = found.filter(place => chosen.has(placeKey(place)));
    const fresh = picked.filter(place => !byKey.has(placeKey(place)));
    let addedVisits = 0;
    status.textContent = `Importing ${plural(picked.length, 'place', 'places')}…`;
    try {
        if (fresh.length) await ctx.api.importMarkers(fresh);
        for (const place of picked.filter(item => byKey.has(placeKey(item)))) {
            const marker = byKey.get(placeKey(place));
            const known = new Set((marker.visits || []).map(visit => visit.startDate));
            for (const visit of place.visits.filter(item => !known.has(item.startDate))) {
                await ctx.api.addVisit(marker.id, visit);
                known.add(visit.startDate);
                addedVisits += 1;
            }
        }
        await ctx.reloadMarkers();
        const message = `Imported ${plural(fresh.length, 'new place', 'new places')}${addedVisits ? ` and ${plural(addedVisits, 'visit', 'visits')} to places you had` : ''}.`;
        status.textContent = message;
        toast(message, { tone: 'success' });
    } catch (error) {
        status.textContent = error.message || 'The import did not finish.';
        ctx.handleError(error);
    }
}

async function importPolarsteps(ctx, files, status) {
    try {
        status.textContent = 'Reading your Polarsteps trips…';
        const trips = await polarstepsTrips(files);
        await previewAndImport(ctx, mergeByName(trips.flatMap(polarstepsPlaces)), status, `From ${plural(trips.length, 'trip', 'trips')}.`);
    } catch (error) {
        status.textContent = error instanceof SyntaxError ? 'That file is not a Polarsteps trip.' : error.message;
    }
}

async function importCountryList(ctx, status) {
    const values = await formDialog({
        title: 'Paste your countries',
        message: 'From Been, Visited or any list: one country per line, or separated by commas.',
        submitLabel: 'Preview',
        fields: [{ name: 'list', label: 'Countries', type: 'textarea', required: true, maxlength: 20_000, placeholder: 'France\nJapan\nPortugal' }]
    });
    if (!values) return;
    const { places, unknown } = countryListPlaces(values.list, ctx.state.index);
    await previewAndImport(ctx, places, status, unknown.length ? `Not recognized: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? '…' : ''}.` : '');
}

/** The buttons of the data section that import from other apps. */
export function importButtons(ctx, status) {
    const input = h('input', {
        type: 'file',
        accept: '.zip,.json,application/zip,application/json',
        multiple: true,
        class: 'visually-hidden',
        id: 'polarsteps-file',
        onchange: event => {
            const files = [...event.target.files];
            if (files.length) importPolarsteps(ctx, files, status).finally(() => { event.target.value = ''; });
        }
    });
    return [
        h('label', { class: 'btn btn-ghost btn-sm', for: 'polarsteps-file' }, '⬆️ Polarsteps'),
        input,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => importCountryList(ctx, status) }, '📋 Paste countries')
    ];
}
