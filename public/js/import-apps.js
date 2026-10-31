// Importing from other travel apps, with a preview: a Polarsteps data export (its ZIP, or the
// trip.json files in it), a pasted list of countries from Been, Visited and other atlases, and
// visits found in photos' metadata or a phone's location history. The places are read in
// imports.js and auto-import.js; nothing is saved until the traveler confirms, and photos and
// location history never leave the browser: only towns and dates are sent.
import { h, toast, formDialog, formatDate } from './ui.js';
import { placeKey } from './io.js';
import { joinList, t, tn } from './i18n.js';

// The readers load when an import starts, so the first page stays light.
const readers = {
    imports: () => import('./imports.js'),
    sightings: () => import('./auto-import.js'),
    photos: () => import('./exif.js'),
    towns: () => import('./towns.js'),
    zip: () => import('./zip-read.js')
};


// The trips in the chosen files: a whole export as a ZIP, or trip.json files.
async function polarstepsTrips(files) {
    const [{ polarstepsTripEntries }, { readZipText, zipEntries }] = await Promise.all([readers.imports(), readers.zip()]);
    const trips = [];
    for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
            for (const entry of polarstepsTripEntries(await zipEntries(file))) trips.push(JSON.parse(await readZipText(file, entry)));
        } else {
            trips.push(JSON.parse(await file.text()));
        }
    }
    if (!trips.length) throw new Error(t('No Polarsteps trips were found. Choose the ZIP file from “Download my data”, or the trip.json files in it.'));
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

const IMPORT_BATCH = 1000;

/**
 * Saves places: new ones with their visits, a thousand at a time; places already on the map get
 * the visits they lack. Resolves to how many places and visits were added.
 */
export async function savePlaces(ctx, picked) {
    const byKey = markersByKey(ctx);
    const fresh = picked.filter(place => !byKey.has(placeKey(place)));
    let addedVisits = 0;
    for (let i = 0; i < fresh.length; i += IMPORT_BATCH) await ctx.api.importMarkers(fresh.slice(i, i + IMPORT_BATCH));
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
    return { places: fresh.length, visits: addedVisits };
}

async function importPlaces(ctx, picked, status) {
    status.textContent = tn(picked.length, 'Importing {count} place…', 'Importing {count} places…');
    try {
        const { places, visits } = await savePlaces(ctx, picked);
        const parts = [
            places || !visits ? tn(places, '{count} new place', '{count} new places') : '',
            visits ? tn(visits, '{count} visit to places you had', '{count} visits to places you had') : ''
        ].filter(Boolean);
        const message = t('Imported {what}.', { what: parts.join(` ${t('and')} `) });
        status.textContent = message;
        toast(message, { tone: 'success' });
    } catch (error) {
        status.textContent = error.message || t('The import did not finish.');
        ctx.handleError(error);
    }
}

/** Shows the places found, all ticked, and saves the ticked ones. */
async function previewAndImport(ctx, found, status, note = '') {
    if (!found.length) {
        status.textContent = [t('Nothing to import.'), note].filter(Boolean).join(' ');
        return;
    }
    const byKey = markersByKey(ctx);
    const visits = found.reduce((sum, place) => sum + place.visits.length, 0);
    const values = await formDialog({
        title: t('Import these places?'),
        message: [
            visits ? t('{places} with {visits}.', { places: tn(found.length, '{count} place', '{count} places'), visits: tn(visits, '{count} visit', '{count} visits') })
                : `${tn(found.length, '{count} place', '{count} places')}.`,
            t('Untick any you do not want; places already on your map only get the visits they lack.'), note
        ].filter(Boolean).join(' '),
        submitLabel: t('Import'),
        fields: [{
            name: 'places', label: t('Places'), type: 'choices', value: found.map(placeKey),
            options: found.map(place => ({ value: placeKey(place), label: byKey.has(placeKey(place)) ? t('{name} (on your map)', { name: place.name }) : place.name }))
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
        status.textContent = t('No places found. {note}', { note });
        return;
    }
    const byKey = markersByKey(ctx);
    const visits = found.reduce((sum, place) => sum + place.visits.length, 0);
    const values = await formDialog({
        title: t('Import these visits?'),
        message: [
            t('{visits} to {places}, by the nearest town.', { visits: tn(visits, '{count} visit', '{count} visits'), places: tn(found.length, '{count} place', '{count} places') }),
            note, t('Untick any you do not want; places already on your map only get the visits they lack.')
        ].filter(Boolean).join(' '),
        submitLabel: t('Import'),
        fields: found.map((place, i) => ({
            name: `place-${i}`, type: 'choices', label: byKey.has(placeKey(place)) ? t('{name} (on your map)', { name: place.name }) : place.name,
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
    else status.textContent = t('Nothing imported.');
}

// Towns from the bundled data: the base list now, region tiles as points need them.
let townFinder = null;
export async function findTowns(ctx) {
    if (!townFinder) {
        const { createTownFinder } = await readers.towns();
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
    const [{ photoMetadata }, { placesFromSightings }] = await Promise.all([readers.photos(), readers.sightings()]);
    const sightings = [];
    let unplaced = 0;
    for (const [i, file] of files.entries()) {
        if (i % 25 === 0) status.textContent = t('Reading photo {number} of {total}…', { number: i + 1, total: files.length });
        const found = await photoMetadata(file).catch(() => null);
        if (Number.isFinite(found?.lat) && found.date) sightings.push({ lat: found.lat, lng: found.lng, startDate: found.date, endDate: found.date });
        else unplaced += 1;
    }
    status.textContent = t('Finding the towns…');
    const places = await placesFromSightings(sightings, { ...(await findTowns(ctx)), source: t('From photos') });
    await reviewVisits(ctx, places, status, [
        tn(sightings.length, 'From {count} photo.', 'From {count} photos.'),
        unplaced ? tn(unplaced, '{count} photo has no place or date.', '{count} photos have no place or date.') : ''
    ].filter(Boolean).join(' '));
}

// Location history files: JSON files, or the .json entries of a Takeout ZIP. Raw location
// records (Records.json) are too large and too fine to read here.
async function historyFiles(files) {
    const { readZipText, zipEntries } = await readers.zip();
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
        status.textContent = t('Reading your location history…');
        const { placesFromSightings, timelineSightings } = await readers.sightings();
        const sightings = [];
        for (const text of await historyFiles(files)) {
            try {
                sightings.push(...timelineSightings(JSON.parse(text)));
            } catch {
                // Other JSON files in an export, such as settings, are not location history.
            }
        }
        status.textContent = t('Finding the towns…');
        const places = await placesFromSightings(sightings, { ...(await findTowns(ctx)), source: t('From location history') });
        await reviewVisits(ctx, places, status, tn(sightings.length, 'From {count} stay in your location history.', 'From {count} stays in your location history.'));
    } catch (error) {
        status.textContent = error.message || t('That file could not be read.');
    }
}

async function importPolarsteps(ctx, files, status) {
    try {
        status.textContent = t('Reading your Polarsteps trips…');
        const trips = await polarstepsTrips(files);
        const { polarstepsPlaces } = await readers.imports();
        await previewAndImport(ctx, mergeByName(trips.flatMap(polarstepsPlaces)), status, tn(trips.length, 'From {count} trip.', 'From {count} trips.'));
    } catch (error) {
        status.textContent = error instanceof SyntaxError ? t('That file is not a Polarsteps trip.') : error.message;
    }
}

async function importCountryList(ctx, status) {
    const values = await formDialog({
        title: t('Paste your countries'),
        message: t('From Been, Visited or any list: one country per line, or separated by commas.'),
        submitLabel: t('Preview'),
        fields: [{ name: 'list', label: t('Countries'), type: 'textarea', required: true, maxlength: 20_000, placeholder: t('France\nJapan\nPortugal') }]
    });
    if (!values) return;
    const { countryListPlaces } = await readers.imports();
    const { places, unknown } = countryListPlaces(values.list, ctx.state.index);
    await previewAndImport(ctx, places, status, unknown.length ? t('Not recognized: {names}.', { names: `${joinList(unknown.slice(0, 10))}${unknown.length > 10 ? '…' : ''}` }) : '');
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
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => importCountryList(ctx, status) }, t('📋 Paste countries')),
        ...fileButton('photos-file', t('📷 Photos'), 'image/jpeg,image/heic,image/heif,.jpg,.jpeg,.heic,.heif', files => importPhotos(ctx, files, status)),
        ...fileButton('history-file', t('🧭 Location history'), '.zip,.json,application/zip,application/json', files => importLocationHistory(ctx, files, status))
    ];
}
