// Importing from other travel apps, with a preview: a Polarsteps data export (its ZIP, or the
// trip.json files in it), a pasted list of countries from Been, Visited and other atlases, and
// visits found in photos' metadata or a phone's location history. The places are read in
// imports.js and auto-import.js; nothing is saved until the traveler confirms, and photos and
// location history never leave the browser: only towns and dates are sent.
import { h, toast, formDialog, formatDate } from './ui.js';
import { placeKey } from './io.js';
import { countryListPlaces, polarstepsPlaces, polarstepsTripEntries } from './imports.js';
import { placesFromSightings, timelineSightings } from './auto-import.js';
import { photoMetadata } from './exif.js';
import { createTownFinder } from './towns.js';
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

const markersByKey = ctx => new Map(ctx.state.markers.map(marker => [placeKey(marker), marker]));

/** Saves places: new ones with their visits; places already on the map get the visits they lack. */
async function importPlaces(ctx, picked, status) {
    const byKey = markersByKey(ctx);
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
        const parts = [
            fresh.length || !addedVisits ? plural(fresh.length, 'new place', 'new places') : '',
            addedVisits ? `${plural(addedVisits, 'visit', 'visits')} to places you had` : ''
        ].filter(Boolean);
        const message = `Imported ${parts.join(' and ')}.`;
        status.textContent = message;
        toast(message, { tone: 'success' });
    } catch (error) {
        status.textContent = error.message || 'The import did not finish.';
        ctx.handleError(error);
    }
}

/** Shows the places found, all ticked, and saves the ticked ones. */
async function previewAndImport(ctx, found, status, note = '') {
    if (!found.length) {
        status.textContent = `Nothing to import.${note ? ` ${note}` : ''}`;
        return;
    }
    const byKey = markersByKey(ctx);
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
    await importPlaces(ctx, found.filter(place => chosen.has(placeKey(place))), status);
}

const stayLabel = ({ startDate, endDate }) => (endDate && endDate !== startDate
    ? `${formatDate(startDate)} – ${formatDate(endDate)}` : formatDate(startDate));

/**
 * Shows every visit found, by place, all ticked; saves the places with their ticked visits.
 * Found automatically, each visit is the traveler's to confirm.
 */
async function reviewVisits(ctx, found, status, note) {
    if (!found.length) {
        status.textContent = `No places found. ${note}`;
        return;
    }
    const byKey = markersByKey(ctx);
    const visits = found.reduce((sum, place) => sum + place.visits.length, 0);
    const values = await formDialog({
        title: 'Import these visits?',
        message: `${plural(visits, 'visit', 'visits')} to ${plural(found.length, 'place', 'places')}, by the nearest town. ${note} `
            + 'Untick any you do not want; places already on your map only get the visits they lack.',
        submitLabel: 'Import',
        fields: found.map((place, i) => ({
            name: `place-${i}`, type: 'choices', label: `${place.name}${byKey.has(placeKey(place)) ? ' (on your map)' : ''}`,
            value: place.visits.map(visit => visit.startDate),
            options: place.visits.map(visit => ({ value: visit.startDate, label: stayLabel(visit) }))
        }))
    });
    if (!values) return;
    const picked = found.map((place, i) => {
        const chosen = new Set(values[`place-${i}`]);
        return { ...place, visits: place.visits.filter(visit => chosen.has(visit.startDate)) };
    }).filter(place => place.visits.length);
    if (picked.length) await importPlaces(ctx, picked, status);
    else status.textContent = 'Nothing imported.';
}

// Towns from the bundled data: the base list now, region tiles as points need them.
let townFinder = null;
async function findTowns(ctx) {
    if (!townFinder) {
        const data = file => new URL(`../data/cities/${file}`, import.meta.url);
        const tiles = await fetch(data('index.json')).then(response => (response.ok ? response.json() : []));
        townFinder = createTownFinder({
            cities: ctx.state.cities, tiles,
            loadTile: id => fetch(data(`${id}.json`)).then(response => {
                if (!response.ok) throw new Error(`Town tile ${id}: HTTP ${response.status}`);
                return response.json();
            })
        });
    }
    const { index } = ctx.state;
    return {
        townNear: townFinder,
        countryAt: (lat, lng) => index.findAt(lat, lng),
        countryById: id => index.byId.get(id)
    };
}

async function importPhotos(ctx, files, status) {
    const sightings = [];
    let unplaced = 0;
    for (const [i, file] of files.entries()) {
        if (i % 25 === 0) status.textContent = `Reading photo ${i + 1} of ${files.length}…`;
        const found = await photoMetadata(file).catch(() => null);
        if (Number.isFinite(found?.lat) && found.date) sightings.push({ lat: found.lat, lng: found.lng, startDate: found.date, endDate: found.date });
        else unplaced += 1;
    }
    status.textContent = 'Finding the towns…';
    const places = await placesFromSightings(sightings, { ...(await findTowns(ctx)), source: 'From photos' });
    await reviewVisits(ctx, places, status, `From ${plural(sightings.length, 'photo', 'photos')}${unplaced ? `; ${plural(unplaced, 'photo has', 'photos have')} no place or date` : ''}.`);
}

// Location history files: JSON files, or the .json entries of a Takeout ZIP. Raw location
// records (Records.json) are too large and too fine to read here.
async function historyFiles(files) {
    const texts = [];
    for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
            for (const entry of (await zipEntries(file)).filter(item => /\.json$/i.test(item.name) && !/(^|\/)Records\.json$/i.test(item.name))) {
                texts.push(await readZipText(file, entry));
            }
        } else texts.push(await file.text());
    }
    return texts;
}

async function importLocationHistory(ctx, files, status) {
    try {
        status.textContent = 'Reading your location history…';
        const sightings = [];
        for (const text of await historyFiles(files)) {
            try {
                sightings.push(...timelineSightings(JSON.parse(text)));
            } catch {
                // Other JSON files in an export, such as settings, are not location history.
            }
        }
        status.textContent = 'Finding the towns…';
        const places = await placesFromSightings(sightings, { ...(await findTowns(ctx)), source: 'From location history' });
        await reviewVisits(ctx, places, status, `From ${plural(sightings.length, 'stay', 'stays')} in your location history.`);
    } catch (error) {
        status.textContent = error.message || 'That file could not be read.';
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

// A button that opens the file picker and hands the chosen files to `read`.
function fileButton(id, label, accept, read) {
    return [
        h('label', { class: 'btn btn-ghost btn-sm', for: id }, label),
        h('input', {
            type: 'file', accept, multiple: true, class: 'visually-hidden', id,
            onchange: event => {
                const files = [...event.target.files];
                if (files.length) read(files).finally(() => { event.target.value = ''; });
            }
        })
    ];
}

/** The buttons of the data section that import from other apps, photos and location history. */
export function importButtons(ctx, status) {
    return [
        ...fileButton('polarsteps-file', '⬆️ Polarsteps', '.zip,.json,application/zip,application/json', files => importPolarsteps(ctx, files, status)),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => importCountryList(ctx, status) }, '📋 Paste countries'),
        ...fileButton('photos-file', '📷 Photos', 'image/jpeg,image/heic,image/heif,.jpg,.jpeg,.heic,.heif', files => importPhotos(ctx, files, status)),
        ...fileButton('history-file', '🧭 Location history', '.zip,.json,application/zip,application/json', files => importLocationHistory(ctx, files, status))
    ];
}
