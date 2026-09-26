// Thin JSON client for the TravelMapster server.

async function request(method, url, body) {
    const options = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }
    if (!response.ok) {
        const error = new Error(data?.error || `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }
    return data;
}

export const api = {
    currentUser: () => request('GET', '/current_user'),
    login: (username, password) => request('POST', '/login', { username, password }),
    register: (username, password) => request('POST', '/register', { username, password }),
    logout: () => request('POST', '/logout'),
    saveProfile: profileVisibility => request('PATCH', '/profile', { profileVisibility }),

    getMarkers: () => request('GET', '/getMarkers'),
    addMarker: marker => request('POST', '/addMarker', marker),
    updateMarker: (id, marker) => request('PATCH', `/updateMarker/${Number(id)}`, marker),
    deleteMarker: id => request('DELETE', `/deleteMarker/${Number(id)}`),

    getTrips: () => request('GET', '/trips'),
    createTrip: trip => request('POST', '/trips', trip),
    updateTrip: (id, trip) => request('PUT', `/trips/${Number(id)}`, trip),
    deleteTrip: id => request('DELETE', `/trips/${Number(id)}`),

    getPublicMap: username => request('GET', `/public/${encodeURIComponent(username)}`)
};
