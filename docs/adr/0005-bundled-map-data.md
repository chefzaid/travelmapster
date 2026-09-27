# ADR 0005: Bundle Map Data And Proxy Geocoding

- Status: Accepted
- Date: 2026-09-27

## Context

The map must stay simple and cartoonish (country borders only), work without third-party tile
services, and still find small towns that the built-in data does not contain.

## Decision

Ship simplified Natural Earth country borders and every GeoNames town of 500+ people, graded
by reveal zoom and split into region tiles, in `public/data/`, rebuilt by
`scripts/build-map-data.js`. The server indexes the same towns for search. For anything else, the server proxies Nominatim at `/api/geocode` with an identifying User-Agent, at most
one request per interval across all replicas (booked in PostgreSQL), a timeout and an in-memory
cache, as its usage policy requires. See [map data](../data-model.md#map-data).

## Consequences

- No tile provider, API key or per-view cost; visitors' map views are not sent to third parties.
- About 125 KB of base cities load with the page; region tiles (about 45 KB each, compressed)
  load on demand. The image carries 12 MB of data and the search index about 90 MB of memory.
- GeoNames is CC BY 4.0, so the map credits it. Data updates need a rebuild.
- Geocoding depends on a public service with strict limits: failures return 502 and built-in
  search keeps working. Every search costs one extra database round trip for the throttle.
