'use strict';

/**
 * Server-side Nominatim client. Browsers never call Nominatim directly, so the
 * app can honour its usage policy: an identifying User-Agent, at most one
 * request per interval per process, and caching of repeated lookups.
 */
function createGeocoder({ baseUrl, userAgent, minIntervalMs, timeoutMs, cacheSize }, fetchImpl = fetch) {
    const cache = new Map();
    let queue = Promise.resolve();
    let lastRequestAt = 0;

    function remember(key, value) {
        cache.delete(key);
        cache.set(key, value);
        if (cache.size > cacheSize) {
            cache.delete(cache.keys().next().value);
        }
    }

    function throttled(task) {
        const run = queue.then(async () => {
            const wait = lastRequestAt + minIntervalMs - Date.now();
            if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
            lastRequestAt = Date.now();
            return task();
        });
        // Keep the queue alive even when a request fails.
        queue = run.catch(() => {});
        return run;
    }

    function toPlace(item, kind) {
        const address = item.address || {};
        const country = address.country || '';
        const cityName = address.city || address.town || address.village || address.municipality || item.name || '';
        const name = kind === 'city'
            ? [cityName, country].filter(Boolean).join(', ')
            : country || item.name || '';
        return {
            name,
            city: kind === 'city' ? cityName : '',
            country,
            displayName: item.display_name || name,
            lat: Number(item.lat),
            lng: Number(item.lon)
        };
    }

    async function search(query, kind, limit) {
        const key = `${kind}:${limit}:${query.toLowerCase()}`;
        if (cache.has(key)) {
            const cached = cache.get(key);
            remember(key, cached);
            return cached;
        }

        const params = new URLSearchParams({
            format: 'jsonv2',
            q: query,
            addressdetails: '1',
            limit: String(limit)
        });
        if (kind === 'country') params.set('featureType', 'country');
        if (kind === 'city') params.set('featureType', 'settlement');

        const places = await throttled(async () => {
            const response = await fetchImpl(`${baseUrl}/search?${params}`, {
                headers: { 'User-Agent': userAgent, Accept: 'application/json' },
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (!response.ok) {
                const error = new Error(`Geocoder responded with HTTP ${response.status}`);
                error.status = 502;
                throw error;
            }
            const body = await response.json();
            return (Array.isArray(body) ? body : [])
                .map(item => toPlace(item, kind))
                .filter(place => place.name && Number.isFinite(place.lat) && Number.isFinite(place.lng));
        });

        remember(key, places);
        return places;
    }

    return { search };
}

module.exports = { createGeocoder };
