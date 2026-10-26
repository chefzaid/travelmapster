// Thin JSON client for the TravelMapster API (/api/*) with CSRF token handling.

let csrfToken = null;

async function refreshCsrfToken() {
    const response = await fetch('/api/csrf-token', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to reach TravelMapster right now.');
    csrfToken = (await response.json()).csrfToken;
    return csrfToken;
}

async function request(method, path, body, retried = false) {
    /** @type {RequestInit & { headers: Record<string, string> }} */
    const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (method !== 'GET') {
        options.headers['X-CSRF-Token'] = csrfToken || await refreshCsrfToken();
    }
    if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`/api${path}`, options);
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }
    if (response.status === 403 && data?.code === 'CSRF' && !retried) {
        // The session rotated (login, logout or expiry): fetch a fresh token once.
        await refreshCsrfToken();
        return request(method, path, body, true);
    }
    if (!response.ok) {
        throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), { status: response.status });
    }
    if (data?.csrfToken) csrfToken = data.csrfToken;
    return data;
}

// The API stores empty optional fields as null; the UI works with strings.
function toClientVisit(visit) {
    return { ...visit, endDate: visit.endDate || '', notes: visit.notes || '', photoUrl: visit.photoUrl || '', ongoing: Boolean(visit.ongoing) };
}

function toClientMarker(marker) {
    return {
        ...marker,
        photoUrl: marker.photoUrl || '',
        notes: marker.notes || '',
        travelDate: marker.travelDate || '',
        rating: marker.rating || null,
        tags: marker.tags || [],
        emoji: marker.emoji || '',
        hideFromPublic: Boolean(marker.hideFromPublic),
        priority: marker.priority || '',
        bestMonths: marker.bestMonths || [],
        stay: marker.stay || 'visit',
        visits: (marker.visits || []).map(toClientVisit)
    };
}

// Place edits leave the visits alone: they have their own routes, and a travel date sent
// along would be read the legacy way (migration 004).
function placeFields(marker) {
    const { lat, lng, type, name, category, photoUrl, notes, rating, tags, emoji, hideFromPublic, priority, bestMonths, stay } = marker;
    return {
        lat, lng, type, name, category, photoUrl, notes,
        rating: rating || null, tags: tags || [], emoji: emoji || '', hideFromPublic: Boolean(hideFromPublic),
        priority: priority || null, bestMonths: bestMonths || [],
        // A wish is never lived in or passed through.
        stay: type === 'wishlist' ? 'visit' : stay || 'visit'
    };
}

export const api = {
    currentUser: async () => (await request('GET', '/auth/me')).user,
    login: async (username, password) => (await request('POST', '/auth/login', { username, password })).user,
    register: async (username, password, website = '') => (await request('POST', '/auth/register', { username, password, website })).user,
    logout: () => request('POST', '/auth/logout', {}),
    // Sends only the settings that change: profileVisibility, homeCountry.
    saveProfile: changes => request('PATCH', '/profile', changes),
    changePassword: (currentPassword, newPassword) => request('POST', '/auth/password', { currentPassword, newPassword }),
    deleteAccount: password => request('DELETE', '/auth/account', { password }),

    getMarkers: async () => (await request('GET', '/markers')).map(toClientMarker),
    addMarker: async marker => toClientMarker(await request('POST', '/markers', marker)),
    importMarkers: markers => request('POST', '/markers/import', { markers }),
    // Creates, changes the status of and removes places all at once, or not at all.
    bulkMarkers: async changes => {
        const result = await request('POST', '/markers/bulk', changes);
        return { ...result, created: result.created.map(toClientMarker), updated: result.updated.map(toClientMarker) };
    },
    updateMarker: async (id, marker) => toClientMarker(await request('PATCH', `/markers/${Number(id)}`, placeFields(marker))),
    deleteMarker: id => request('DELETE', `/markers/${Number(id)}`),

    addVisit: async (markerId, visit) => toClientVisit(await request('POST', `/markers/${Number(markerId)}/visits`, visit)),
    updateVisit: async (id, visit) => toClientVisit(await request('PATCH', `/visits/${Number(id)}`, visit)),
    deleteVisit: id => request('DELETE', `/visits/${Number(id)}`),

    getLedger: () => request('GET', '/ledger'),
    saveLedger: settings => request('PUT', '/ledger', settings),
    getVisitChanges: () => request('GET', '/ledger/changes'),

    getTrips: () => request('GET', '/trips'),
    exportAccount: () => request('GET', '/export'),
    createTrip: trip => request('POST', '/trips', trip),
    updateTrip: (id, trip) => request('PUT', `/trips/${Number(id)}`, trip),
    deleteTrip: id => request('DELETE', `/trips/${Number(id)}`),

    getPublicMap: async username => {
        const data = await request('GET', `/public/${encodeURIComponent(username)}`);
        return { ...data, markers: data.markers.map(toClientMarker) };
    },

    searchPlaces: query => request('GET', `/places?${new URLSearchParams({ q: query, limit: '6' })}`),
    geocodeCity: query => request('GET', `/geocode?${new URLSearchParams({ q: query, kind: 'city', limit: '1' })}`)
};
