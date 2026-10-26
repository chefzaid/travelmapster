// Service worker of the installable app (ADR 0021): the app and its bundled map data work
// offline, and the traveler's own places, trips and ledger show as last loaded. Writes always
// need the network.
const ASSETS = 'travelmapster-assets';
const PAGES = 'travelmapster-pages';
const ACCOUNT = 'travelmapster-account';
// Reads of the traveler's own data that may answer offline, as last loaded.
const ACCOUNT_READS = ['/api/auth/me', '/api/markers', '/api/trips', '/api/ledger', '/api/ledger/changes', '/api/orgs', '/api/csrf-token'];
// Signing in, out or deleting the account changes whose data this is: drop the copy.
const SESSION_CHANGES = /^\/api\/auth\/(login|logout|register|account)$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

// Network first, keeping the last good answer for when the network is gone.
async function networkFirst(cacheName, request, key = request) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        if (response.ok) await cache.put(key, response.clone());
        // Signed out (or the session expired): nothing of the account stays on the device.
        else if (response.status === 401 && cacheName === ACCOUNT) await caches.delete(ACCOUNT);
        return response;
    } catch (error) {
        const cached = await cache.match(key);
        if (cached) return cached;
        throw error;
    }
}

// Fingerprinted assets never change: from the cache when there, and a new release drops the
// files of the old one.
async function cacheFirst(request, version) {
    const cache = await caches.open(ASSETS);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
        await cache.put(request, response.clone());
        for (const old of await cache.keys()) {
            if (!new URL(old.url).pathname.startsWith(`/a/${version}/`)) await cache.delete(old);
        }
    }
    return response;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (SESSION_CHANGES.test(url.pathname)) {
        event.waitUntil(caches.delete(ACCOUNT));
        return;
    }
    if (request.method !== 'GET') return;
    const asset = url.pathname.match(/^\/a\/([0-9a-f]{12})\//);
    if (asset) {
        event.respondWith(cacheFirst(request, asset[1]));
    } else if (request.mode === 'navigate' && url.pathname === '/' && !url.searchParams.has('u')) {
        // The app page; shared maps and other pages always need the network.
        event.respondWith(networkFirst(PAGES, request, '/'));
    } else if (ACCOUNT_READS.includes(url.pathname)) {
        event.respondWith(networkFirst(ACCOUNT, request));
    }
});
