'use strict';

/** In-process throttle: returns how long to wait before the next request may start. */
function createLocalSlots(minIntervalMs) {
    let nextAt = 0;
    return async () => {
        const start = Math.max(nextAt, Date.now());
        nextAt = start + minIntervalMs;
        return start - Date.now();
    };
}

/**
 * Throttle shared by every replica: one atomic update books the next free start
 * time in PostgreSQL and returns how long this request must wait for it.
 */
function createPgSlots(pool, minIntervalMs) {
    return async () => {
        const { rows } = await pool.query(
            `UPDATE geocoder_throttle
             SET next_at = GREATEST(next_at, now()) + $1 * interval '1 millisecond'
             WHERE id = 1
             RETURNING GREATEST(0, EXTRACT(EPOCH FROM (next_at - now())) * 1000 - $1) AS wait_ms`,
            [minIntervalMs]
        );
        return Number(rows[0].wait_ms);
    };
}

/**
 * Server-side Nominatim client. Browsers never call Nominatim directly, so the
 * app can honour its usage policy: an identifying User-Agent, at most one
 * request per interval, and caching of repeated lookups.
 */
function createGeocoder({ baseUrl, userAgent, minIntervalMs, timeoutMs, cacheSize }, fetchImpl = fetch,
    reserveSlot = createLocalSlots(minIntervalMs)) {
    const cache = new Map();

    function remember(key, value) {
        cache.delete(key);
        cache.set(key, value);
        if (cache.size > cacheSize) {
            cache.delete(cache.keys().next().value);
        }
    }

    async function throttled(task) {
        const wait = await reserveSlot();
        // A long queue means Nominatim is saturated; fail fast rather than hold the request.
        if (wait > timeoutMs) {
            const error = new Error('Geocoder is busy');
            error.status = 503;
            throw error;
        }
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        return task();
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

module.exports = { createGeocoder, createLocalSlots, createPgSlots };
