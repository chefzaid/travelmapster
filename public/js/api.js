// Thin JSON client for the TravelMapster API (/api/*) with CSRF token handling.

let csrfToken = null;

// fetch, with a message for people when the network or the server is out of reach.
async function reach(url, options) {
    try {
        return await fetch(url, options);
    } catch {
        throw new Error(navigator.onLine === false
            ? 'You are offline: this change was not saved. Try again once you are back online.'
            : 'TravelMapster cannot be reached right now. Please try again.');
    }
}

async function refreshCsrfToken() {
    const response = await reach('/api/csrf-token', { credentials: 'same-origin' });
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

    const response = await reach(`/api${path}`, options);
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
        // The answer comes along, such as the newer trip of a refused save (ADR 0028).
        throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), { status: response.status, data });
    }
    if (data?.csrfToken) csrfToken = data.csrfToken;
    return data;
}

// The API stores empty optional fields as null; the UI works with strings.
export function toClientVisit(visit) {
    return {
        ...visit, endDate: visit.endDate || '', notes: visit.notes || '', photoUrl: visit.photoUrl || '', ongoing: Boolean(visit.ongoing),
        // A replica of an older release sends no purpose: every visit was personal.
        purpose: visit.purpose || 'personal', organizationId: visit.organizationId ?? null
    };
}

export function toClientMarker(marker) {
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
    // The user, or `{ secondStep: true }` when two-step sign-in asks for a code next (ADR 0027).
    login: (username, password) => request('POST', '/auth/login', { username, password }),
    secondStep: async answer => (await request('POST', '/auth/login/second-step', answer)).user,
    passkeyLoginOptions: () => request('POST', '/security/passkey-login/options', {}),
    passkeyLogin: async response => (await request('POST', '/security/passkey-login', { response })).user,
    security: () => request('GET', '/security'),
    passkeyOptions: () => request('POST', '/security/passkeys/options', {}),
    addPasskey: (name, response) => request('POST', '/security/passkeys', { name, response }),
    removePasskey: id => request('DELETE', `/security/passkeys/${encodeURIComponent(id)}`),
    twoStepSetup: () => request('POST', '/security/two-step/setup', {}),
    twoStepEnable: code => request('POST', '/security/two-step/enable', { code }),
    twoStepDisable: password => request('POST', '/security/two-step/disable', { password }),
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
    getTripMembers: id => request('GET', `/trips/${Number(id)}/members`),
    shareTrip: (id, username, role) => request('PUT', `/trips/${Number(id)}/members/${encodeURIComponent(username)}`, { role }),
    unshareTrip: (id, username) => request('DELETE', `/trips/${Number(id)}/members/${encodeURIComponent(username)}`),

    getOrgs: () => request('GET', '/orgs'),
    getOrgAudit: () => request('GET', '/orgs/audit'),
    createOrg: name => request('POST', '/orgs', { name }),
    joinOrg: token => request('POST', '/orgs/join', { token }),
    renameOrg: (id, name) => request('PATCH', `/orgs/${Number(id)}`, { name }),
    deleteOrg: id => request('DELETE', `/orgs/${Number(id)}`),
    saveOrgRules: (id, rules) => request('PUT', `/orgs/${Number(id)}/rules`, { rules }),
    saveOrgChecklist: (id, checklist) => request('PUT', `/orgs/${Number(id)}/checklist`, { checklist }),
    getOrgMembers: id => request('GET', `/orgs/${Number(id)}/members`),
    setOrgRole: (id, username, role) => request('PATCH', `/orgs/${Number(id)}/members/${encodeURIComponent(username)}`, { role }),
    removeOrgMember: (id, username) => request('DELETE', `/orgs/${Number(id)}/members/${encodeURIComponent(username)}`),
    getOrgInvitations: id => request('GET', `/orgs/${Number(id)}/invitations`),
    inviteToOrg: (id, role) => request('POST', `/orgs/${Number(id)}/invitations`, { role }),
    revokeOrgInvitation: (id, invitationId) => request('DELETE', `/orgs/${Number(id)}/invitations/${Number(invitationId)}`),
    getOrgReport: (id, { from, to }) => request('GET', `/orgs/${Number(id)}/report?${new URLSearchParams({ from, to })}`),

    getFollows: () => request('GET', '/follows'),
    follow: username => request('POST', '/follows', { username }),
    unfollow: username => request('DELETE', `/follows/${encodeURIComponent(username)}`),

    getPublicMap: async username => {
        const data = await request('GET', `/public/${encodeURIComponent(username)}`);
        return { ...data, markers: data.markers.map(toClientMarker) };
    },

    searchPlaces: query => request('GET', `/places?${new URLSearchParams({ q: query, limit: '6' })}`),
    geocodeCity: query => request('GET', `/geocode?${new URLSearchParams({ q: query, kind: 'city', limit: '1' })}`)
};

// The server's answers, so guest mode can stand in for them and step aside again.
const serverApi = Object.freeze({ ...api });

/**
 * Answers from `methods` instead of the server (a guest map, ADR 0026), or from the server
 * again with null. Every module holds the same `api` object, so they all follow.
 */
export function useApi(methods) {
    Object.assign(api, serverApi, methods || {});
}
