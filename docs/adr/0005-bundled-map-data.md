# ADR 0005: Bundle Map Data And Proxy Geocoding

- Status: Accepted
- Date: 2026-09-27

## Context

The map must stay simple and cartoonish (country borders only), work without third-party tile
services, and still find small towns that the built-in data does not contain.

## Decision

Ship simplified Natural Earth country borders and about 7,000 graded cities in `public/data/`,
rebuilt by `scripts/build-map-data.js`, and draw them with Leaflet as vector shapes. For other
places, the server proxies Nominatim at `/api/geocode` with an identifying User-Agent, at most
one request per interval across all replicas (booked in PostgreSQL), a timeout and an in-memory
cache, as its usage policy requires. See [map data](../data-model.md#map-data).

## Consequences

- No tile provider, API key or per-view cost; visitors' map views are not sent to third parties.
- The city file costs about 110 KB compressed on first load, and data updates need a rebuild.
- Geocoding depends on a public service with strict limits: failures return 502 and built-in
  search keeps working. Every search costs one extra database round trip for the throttle.
