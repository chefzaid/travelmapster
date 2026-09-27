# ADR 0002: One Node.js Service Serves The API And A Build-Free Frontend

- Status: Accepted
- Date: 2026-09-27

## Context

TravelMapster is a small product with one team, one database and one hostname. The UI is a map
with a side panel, not a large single-page application.

## Decision

One Express 5 process serves the JSON API under `/api` and the static frontend from `public/`.
The frontend is native ES modules with Leaflet and hand-written CSS: no bundler, framework or
build step. Only `public/` is served.

## Consequences

- One image, one Deployment and one origin: no CORS, a strict same-origin CSP, and cookies
  without cross-site concerns.
- Changes to the frontend are visible on reload; there is no build to break. At startup the
  server fingerprints `public/` and serves the page, never cached, with assets under
  `/a/<fingerprint>/`, cached for a year (`src/assets.js`). A release changes the fingerprint,
  so browsers and the CDN, whose 4-hour browser cache would otherwise override the app's
  headers, never mix old and new files. Modules load data relative to their own URL.
- Growth needs discipline: shared logic belongs in pure, unit-tested modules (`geo.js`, `io.js`),
  and a framework or split service would need a new ADR.
