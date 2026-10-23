# Architecture Overview And ADR Index

## System At A Glance

```mermaid
flowchart LR
    browser[Browser: static ES modules + MapLibre GL] -->|HTML, JS, CSS, map data| app[travelmapster Node.js service]
    browser -->|JSON /api, session cookie + CSRF header| app
    browser -->|itinerary ideas| wikivoyage[(Wikivoyage API)]
    app --> pg[(PostgreSQL: users, places, visits, ledger settings and date history, trips, sessions)]
    app -->|throttled, cached| nominatim[(Nominatim)]
    browser -->|region tiles of towns| app
    prometheus[Prometheus] -->|:9464/metrics| app
```

One Express 5 process serves both the static frontend in `public/` and the JSON API under
`/api`. There is no frontend build step: the browser loads native ES modules. State lives in
PostgreSQL, including sessions, so any replica can serve any request.

## Backend

| Module | Responsibility |
|---|---|
| `src/server.js` | Startup: config, migrations with retry, HTTP and metrics servers, graceful shutdown |
| `src/app.js` | Express wiring: probes, logging, metrics, security headers, pages and static files, sessions, rate limits, CSRF, routers, error handling |
| `src/assets.js` | Release fingerprint and the HTML pages with their asset links rewritten |
| `src/seo.js` | `robots.txt` and the sitemap of public pages ([ADR 0011](adr/0011-public-pages.md)) |
| `src/config.js` | Validated configuration from environment variables ([reference](development.md#configuration)) |
| `src/routes/` | `auth`, `markers` (places and their visits), `visits`, `ledger` (day-ledger settings and date history), `trips`, `profile` (incl. public maps), `places` and `geocode` routers |
| `src/validation.js` | Every request-body rule and limit |
| `src/rate-limit-store.js` | Rate-limit counters in PostgreSQL, shared by every replica |
| `src/repositories.js` | SQL access, always scoped to the signed-in user (visits through their place) |
| `src/db/migrations/005_day_ledger.sql` | Ledger tables and the triggers that record every change to visit dates ([ADR 0010](adr/0010-day-ledger.md)) |
| `src/services/geocoder.js` | Nominatim client with throttling, timeout and LRU cache |
| `src/services/places.js` | In-memory search over every town in the map data |
| `src/db/` | Connection pool, transactions and [migrations](data-model.md#migrations) |
| `src/middleware/csrf.js` | Synchronizer-token CSRF protection |

## Pages

| Path | Page |
|---|---|
| `/` | The app (`index.html`): the landing page with a demo map when signed out, the user's map when signed in, or a read-only shared map at `/?u=<username>` (sent with `X-Robots-Tag: noindex`) |
| `/schengen-calculator` | The free Schengen 90/180 calculator (`schengen-calculator.html`); `/schengen-calculator.html` redirects here |
| `/robots.txt`, `/sitemap.xml` | Crawler rules and the public pages, with absolute URLs from `PUBLIC_URL` or the request |

## API

JSON under `/api`; errors are `{ "error": "…" }` with a matching status. All routes except
`csrf-token`, `auth` and `public` need a session, and writes need the CSRF header
([security](security.md#request-protection)). Field rules are in the [data model](data-model.md#tables).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/csrf-token` | CSRF token for the current session |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Account and session; responses include a fresh CSRF token |
| GET | `/api/auth/me` | Current user, or 401 |
| POST | `/api/auth/password` | Change password (`currentPassword`, `newPassword`); signs out other sessions |
| DELETE | `/api/auth/account` | Delete the account and all its data (`password`); signs out everywhere |
| GET, POST | `/api/markers` | List saved places, each with its visits newest first, or create one (optionally with `visits`, `rating`, `tags`, `emoji`, `hideFromPublic`, `priority`, `bestMonths` and `stay`: `visit`, `lived` or `transit` for places been to, [ADR 0014](adr/0014-home-lived-and-transit.md)) |
| POST | `/api/markers/import` | Import up to 1,000 places with their visits |
| POST | `/api/markers/bulk` | Apply up to 300 changes all or nothing: places to `create`, status changes to `update` (`{ id, type }`, with an optional `stay`) and ids to `remove`; marking several countries at once and its undo are one call each. Returns `created`, `updated` and `removed`; any id not the caller's is a 404 and nothing is kept |
| PATCH, DELETE | `/api/markers/:id` | Update or remove a place; an update leaves visits alone unless an old client sends `travelDate` ([ADR 0009](adr/0009-places-and-visits.md)), and keeps `rating`, `tags`, `emoji`, `hideFromPublic`, `priority`, `bestMonths` and `stay` unless it sends them ([ADR 0012](adr/0012-place-details.md)); moving a place to the wishlist resets `stay` |
| GET, POST | `/api/markers/:id/visits` | List or add visits of a place (`startDate`, `endDate`, `ongoing`, `notes`, `photoUrl`) |
| PATCH, DELETE | `/api/visits/:id` | Replace or remove a visit |
| GET, PUT | `/api/ledger` | Day-ledger settings: `dayRule`, `rules` (stay rules and thresholds) and `planned` stays, replaced as a whole ([ADR 0010](adr/0010-day-ledger.md)) |
| GET | `/api/ledger/changes` | History of visit dates, newest first (latest 5,000) |
| GET, POST | `/api/trips` | List or create itineraries |
| PUT, DELETE | `/api/trips/:id` | Replace or remove an itinerary |
| PATCH | `/api/profile` | Change account settings, each optional: `profileVisibility` (`private` or `public`) and `homeCountry` (a map code or `null`); returns them all |
| GET | `/api/public/:username` | Read-only public map with visit dates and each place's `stay`, without notes, photo links, ratings, tags, emoji, wishlist plans or the home country, and without places hidden from it ([ADR 0013](adr/0013-hidden-places.md)) |
| GET | `/api/places?q=&limit=` | Search every town in the map data (public, 1–20 results) |
| GET | `/api/geocode?q=&kind=city\|country&limit=` | World place search (1–10 results) |

## Frontend

| Module | Responsibility |
|---|---|
| `public/js/app.js` | App shell: auth, landing page and demo map, map cards, search, tabs, public view |
| `public/js/demo.js` | The landing page's sample traveler, with dates relative to today (pure, unit tested) |
| `public/js/schengen.js`, `calculator.js` | Free Schengen calculator: stay checks and results over `days.js` (pure, unit and property tested), and the page that draws them |
| `public/js/map.js` | MapLibre GL map ([ADR 0008](adr/0008-maplibre-gl.md)): cartoon style from the CSS tokens, country states, towns and tile loading, pins, cards and camera |
| `public/js/geo.js` | Country index, city search, country statuses and how the map draws them, stats, ranks and badges (pure, unit tested) |
| `public/js/status.js` | Place statuses: been there, lived there, transit only and wishlist, and their API fields ([ADR 0014](adr/0014-home-lived-and-transit.md)) (pure, unit tested) |
| `public/js/places.js`, `io.js` | Places tab, import and export (pure `io.js` is unit tested) |
| `public/js/bulk.js` | Marking several countries at once: the bulk change, its undo and the updated places (pure, unit tested) |
| `public/js/details.js` | Ratings, tags, emoji and wishlist plans of a place, the tag and rating filter shared by the list and the map, and the wishlist by next good month (pure, unit tested) |
| `public/js/visits.js` | Visit dates, counts, last-visit filter and validation (pure, unit tested) |
| `public/js/days.js` | Day ledger: day rules, days per country, Schengen 90/180 and stay rules, thresholds, planned stays, alerts and evidence reports (pure, unit and property tested) |
| `public/js/ledger.js` | Ledger tab and the printable evidence report |
| `public/js/trips.js`, `ideas.js` | Trip planner and Wikivoyage ideas |
| `public/js/passport.js` | Passport tab |
| `public/js/api.js`, `ui.js`, `confetti.js` | API client with CSRF handling, DOM helpers, celebration |
| `public/styles.css` | Design tokens and components for light and dark themes |

## Key Flows

### Authenticated request

1. The browser fetches `/api/csrf-token` once and sends it as `X-CSRF-Token` on writes.
2. Express applies the API rate limit, then CSRF validation for unsafe methods.
3. Passport restores the user from the PostgreSQL session; `requireAuth` rejects anonymous calls.
4. `validation.js` checks the body; repositories scope every query to the user.
5. `pino-http` logs the request and Prometheus records its duration by route pattern.

### Place search

Countries and the base cities are matched instantly in the browser; a moment later
`/api/places` answers from an index of every town, loaded in the background at startup. For
anything smaller the "Search the world" option calls `/api/geocode`, which proxies Nominatim with
an identifying User-Agent, at most one request per interval across all replicas (a slot booked
in PostgreSQL) and a per-process cache ([ADR 0005](adr/0005-bundled-map-data.md)).

### Day ledger

The browser loads the ledger settings with the places at sign-in. On every change,
`days.js` expands each visit into days per country under the chosen day rule (a city counts for
its country) and evaluates every rule, threshold and planned stay; the Ledger tab and its alert
badge draw the result. The date history is fetched when the tab or a report needs it. Evidence
reports are built on the device, printed through the browser's print dialog (print styles show
only the report) or downloaded as CSV. See [ADR 0010](adr/0010-day-ledger.md).

### Drawing towns

The base cities load with the page. As you approach a region's zoom, the browser fetches its
tile of smaller towns and hands MapLibre the towns that can appear near the current zoom. A
symbol layer shows each town from its `minZoom`, placed by priority (capitals, then places in the
order they appear) with its name on the right or left; MapLibre resolves collisions and fades
names in and out continuously while zooming. Country names sit on top and win collisions.

### Delivery

GitLab CI tests and packages every branch. On `main`, a confirmed release publishes the image,
commits and tags the version, and Argo CD rolls it out; see the
[delivery flow](deployment.md#delivery-flow).

## ADR Process

Add an ADR when a change alters runtime boundaries, data ownership or retention,
authentication or secret flow, external dependencies, or delivery ownership. Use the next
number (`NNNN-short-title.md`) and the template below. Statuses: **Proposed**, **Accepted**,
**Superseded** (linked to its replacement).

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD

## Context
## Decision
## Consequences
```

## Accepted ADRs

- [ADR 0001: Keep the README short and detail in `docs/`](adr/0001-documentation-structure.md)
- [ADR 0002: One Node.js service serves the API and a build-free frontend](adr/0002-single-service-build-free-frontend.md)
- [ADR 0003: Local accounts with server-side sessions and CSRF tokens](adr/0003-sessions-and-csrf.md)
- [ADR 0004: PostgreSQL with in-app SQL migrations](adr/0004-postgres-and-migrations.md)
- [ADR 0005: Bundle map data and proxy geocoding](adr/0005-bundled-map-data.md)
- [ADR 0006: Deliver through GitLab CI and Argo CD with explicit release jobs](adr/0006-gitlab-argocd-delivery.md)
- [ADR 0008: Render the map with MapLibre GL](adr/0008-maplibre-gl.md)
- [ADR 0009: Split saved places into places and dated visits](adr/0009-places-and-visits.md)
- [ADR 0010: Count travel days in the browser from dated visits](adr/0010-day-ledger.md)
- [ADR 0011: Public pages for visitors without an account](adr/0011-public-pages.md)
- [ADR 0012: Optional details on saved places](adr/0012-place-details.md)
- [ADR 0013: Hide single places from a public map](adr/0013-hidden-places.md)
- [ADR 0014: Home country, lived-there and transit-only places](adr/0014-home-lived-and-transit.md)

Superseded: [ADR 0007: Draw towns on a canvas layer](adr/0007-canvas-towns.md).
