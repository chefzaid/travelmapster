// Guest mode (ADR 0026): the API of api.js kept in this browser's storage, so a visitor without
// an account can use every feature that does not need the server. Places, visits, trips, the
// ledger's settings and the account settings answer in the same shapes as the API. Pure, unit
// tested in Node with any Storage.
import { lastVisitDate, sortVisits } from './visits.js';
import { toClientMarker, toClientVisit } from './api.js';

const KEY = 'travelmapster.guest';
const VERSION = 1;

/** The guest's account settings, as the API's user. */
export const GUEST_USER = Object.freeze({
    id: 0, username: 'Guest', guest: true, profileVisibility: 'private', homeCountry: null, countryList: 'all',
    mapPalette: 'standard', publicJourneys: false, publicIndexing: false, goals: []
});

const PROFILE_FIELDS = ['homeCountry', 'countryList', 'mapPalette', 'goals'];
const PLACE_FIELDS = ['lat', 'lng', 'type', 'stay', 'name', 'category', 'notes', 'photoUrl', 'rating', 'tags', 'emoji', 'hideFromPublic', 'priority', 'bestMonths'];
const TRIP_FIELDS = ['title', 'destination', 'startDate', 'plan', 'stops', 'packing', 'budget'];

const empty = () => ({
    version: VERSION, nextId: 1, profile: {}, markers: [], trips: [],
    ledger: { dayRule: 'presence', rules: [], planned: [] }
});

/** Whether this browser holds a guest map. */
export function hasGuestMap(storage) {
    try {
        return Boolean(storage.getItem(KEY));
    } catch {
        return false;
    }
}

/** Forgets the guest map in this browser. */
export function clearGuestMap(storage) {
    try {
        storage.removeItem(KEY);
    } catch {
        // Nothing to clear where storage is unavailable.
    }
}

function notFound(what) {
    return Object.assign(new Error(`${what} not found.`), { status: 404 });
}

function needsAccount(what) {
    return () => Promise.reject(Object.assign(new Error(`${what} needs an account. Sign up to keep your map and use it everywhere.`), { status: 400 }));
}

/** @returns {Record<string, any>} */
const pick = (source, fields) => Object.fromEntries(fields.filter(field => source[field] !== undefined).map(field => [field, source[field]]));

/** The guest API over `storage` (localStorage in the browser); `now` stamps the records. */
export function createGuestApi(storage, now = () => new Date().toISOString()) {
    const read = () => {
        const stored = JSON.parse(storage.getItem(KEY) || 'null');
        return stored?.version === VERSION ? stored : empty();
    };
    const write = data => {
        try {
            storage.setItem(KEY, JSON.stringify(data));
        } catch {
            throw new Error('This browser has no room left for your guest map. Sign up to keep it in an account.');
        }
    };
    // Reads, changes and saves the guest's data in one step; answers with a copy.
    const change = async edit => {
        const data = read();
        const result = edit(data);
        write(data);
        return result === undefined ? null : structuredClone(result);
    };
    const look = async view => structuredClone(view(read()));

    // Stored as the UI works with them, as api.js hands them over.
    const visitFields = visit => toClientVisit({
        startDate: visit.startDate, endDate: visit.endDate, ongoing: Boolean(visit.ongoing) && !visit.endDate, notes: visit.notes, photoUrl: visit.photoUrl
    });
    const visitOf = (data, visit) => ({ id: data.nextId++, ...visitFields(visit) });
    const withDate = marker => Object.assign(marker, { visits: sortVisits(marker.visits) }, { travelDate: lastVisitDate({ ...marker, travelDate: '' }) });
    const createMarker = (data, place) => {
        const marker = toClientMarker({ id: data.nextId++, ...pick(place, PLACE_FIELDS), createdAt: now(), visits: [] });
        marker.visits = (place.visits || []).map(visit => visitOf(data, visit));
        // Older files carry a single travel date instead of visits.
        if (!marker.visits.length && place.travelDate) marker.visits.push(visitOf(data, { startDate: place.travelDate }));
        data.markers.push(withDate(marker));
        return marker;
    };
    const markerOf = (data, id) => {
        const marker = data.markers.find(item => item.id === Number(id));
        if (!marker) throw notFound('Place');
        return marker;
    };
    const visitById = (data, id) => {
        for (const marker of data.markers) {
            const visit = marker.visits.find(item => item.id === Number(id));
            if (visit) return { marker, visit };
        }
        throw notFound('Visit');
    };
    const sortedTrips = trips => [...trips].sort((a, b) =>
        (b.startDate || b.createdAt).localeCompare(a.startDate || a.createdAt) || b.id - a.id);

    return {
        currentUser: async () => ({ ...GUEST_USER, ...read().profile }),
        saveProfile: changes => change(data => {
            Object.assign(data.profile, pick(changes, PROFILE_FIELDS));
            const { profileVisibility, homeCountry, countryList, mapPalette, publicJourneys, publicIndexing, goals } = { ...GUEST_USER, ...data.profile };
            return { profileVisibility, homeCountry, countryList, mapPalette, publicJourneys, publicIndexing, goals };
        }),

        getMarkers: () => look(data => data.markers),
        addMarker: place => change(data => createMarker(data, place)),
        importMarkers: places => change(data => {
            const markers = places.map(place => createMarker(data, place));
            return { imported: markers.length, skipped: 0, errors: [], markers };
        }),
        bulkMarkers: ({ create = [], update = [], remove = [] }) => change(data => {
            // A stay left out keeps the stored one; a wish is never lived in or passed through.
            const updated = update.map(({ id, type, stay }) => {
                const marker = markerOf(data, id);
                return Object.assign(marker, { type, stay: type === 'wishlist' ? 'visit' : stay || marker.stay });
            });
            for (const id of remove) markerOf(data, id);
            data.markers = data.markers.filter(marker => !remove.includes(marker.id));
            const created = create.map(place => createMarker(data, place));
            return { created, updated, removed: remove };
        }),
        updateMarker: (id, place) => change(data => {
            const marker = markerOf(data, id);
            return Object.assign(marker, toClientMarker({ ...marker, ...pick(place, PLACE_FIELDS) }));
        }),
        deleteMarker: id => change(data => {
            markerOf(data, id);
            data.markers = data.markers.filter(marker => marker.id !== Number(id));
        }),

        addVisit: (markerId, visit) => change(data => {
            const marker = markerOf(data, markerId);
            const added = visitOf(data, visit);
            marker.visits.push(added);
            withDate(marker);
            return added;
        }),
        updateVisit: (id, changes) => change(data => {
            const { marker, visit } = visitById(data, id);
            Object.assign(visit, visitFields({ ...visit, ...changes }));
            withDate(marker);
            return visit;
        }),
        deleteVisit: id => change(data => {
            const { marker, visit } = visitById(data, id);
            marker.visits = marker.visits.filter(item => item !== visit);
            withDate(marker);
        }),

        getLedger: () => look(data => data.ledger),
        saveLedger: settings => change(data => {
            data.ledger = { dayRule: settings.dayRule, rules: settings.rules, planned: settings.planned };
            return data.ledger;
        }),
        // The history of visit dates is kept by the server; a guest map has none.
        getVisitChanges: async () => [],

        getTrips: () => look(data => sortedTrips(data.trips).map(trip => ({ ...trip, startDate: trip.startDate || '' }))),
        createTrip: trip => change(data => {
            /** @type {Record<string, any>} */
            const created = { id: data.nextId++, stops: [], packing: [], budget: {}, ...pick(trip, TRIP_FIELDS), createdAt: now(), updatedAt: now() };
            data.trips.push(created);
            return { ...created, startDate: created.startDate || '' };
        }),
        updateTrip: (id, trip) => change(data => {
            const stored = data.trips.find(item => item.id === Number(id));
            if (!stored) throw notFound('Trip');
            Object.assign(stored, pick(trip, TRIP_FIELDS), { updatedAt: now() });
            return { ...stored, startDate: stored.startDate || '' };
        }),
        deleteTrip: id => change(data => {
            if (!data.trips.some(trip => trip.id === Number(id))) throw notFound('Trip');
            data.trips = data.trips.filter(trip => trip.id !== Number(id));
        }),

        exportAccount: () => look(data => ({
            format: 'travelmapster-account', version: 1, exportedAt: now(),
            profile: { ...GUEST_USER, ...data.profile }, places: data.markers, trips: sortedTrips(data.trips),
            ledger: { settings: data.ledger, changes: [] }
        })),

        // What a guest map cannot do without the server.
        logout: async () => null,
        changePassword: needsAccount('A password'),
        deleteAccount: needsAccount('Deleting an account'),
        geocodeCity: needsAccount('Searching every town in the world'),
        getPublicMap: needsAccount('A shared map'),
        getFollows: async () => [],
        follow: needsAccount('Following friends\' maps'),
        unfollow: needsAccount('Following friends\' maps'),
        getTripMembers: async () => [],
        shareTrip: needsAccount('Planning a trip together'),
        unshareTrip: needsAccount('Planning a trip together'),
        getOrgs: async () => [],
        getOrgAudit: async () => [],
        createOrg: needsAccount('An organization'),
        joinOrg: needsAccount('Joining an organization')
    };
}
