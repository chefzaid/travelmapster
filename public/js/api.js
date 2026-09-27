// Thin JSON client for the TravelMapster API (/api/*) with CSRF token handling.

let csrfToken = null;

async function refreshCsrfToken() {
    const response = await fetch('/api/csrf-token', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to reach TravelMapster right now.');
    csrfToken = (await response.json()).csrfToken;
    return csrfToken;
}

async function request(method, path, body, retried = false) {
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
        const error = new Error(data?.error || `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }
    if (data?.csrfToken) csrfToken = data.csrfToken;
    return data;
}

// The API stores empty optional fields as null; the UI works with strings.
function toClientMarker(marker) {
    return { ...marker, photoUrl: marker.photoUrl || '', notes: marker.notes || '', travelDate: marker.travelDate || '' };
}

export const api = {
    currentUser: async () => (await request('GET', '/auth/me')).user,
    login: async (username, password) => (await request('POST', '/auth/login', { username, password })).user,
    register: async (username, password) => (await request('POST', '/auth/register', { username, password })).user,
    logout: () => request('POST', '/auth/logout', {}),
    saveProfile: profileVisibility => request('PATCH', '/profile', { profileVisibility }),
    changePassword: (currentPassword, newPassword) => request('POST', '/auth/password', { currentPassword, newPassword }),
    deleteAccount: password => request('DELETE', '/auth/account', { password }),

    getMarkers: async () => (await request('GET', '/markers')).map(toClientMarker),
    addMarker: async marker => toClientMarker(await request('POST', '/markers', marker)),
    importMarkers: markers => request('POST', '/markers/import', { markers }),
    updateMarker: async (id, marker) => toClientMarker(await request('PATCH', `/markers/${Number(id)}`, marker)),
    deleteMarker: id => request('DELETE', `/markers/${Number(id)}`),

    getTrips: () => request('GET', '/trips'),
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
