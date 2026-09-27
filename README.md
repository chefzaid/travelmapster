# TravelMapster

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)
![CI](https://github.com/chefzaid/travelmapster/actions/workflows/ci.yml/badge.svg)

TravelMapster is a playful travel atlas. Color in the countries you have visited, pin the cities you love,
keep a wishlist of dream trips, and plan day-by-day itineraries.

## Features

### The map
- [x] Cartoon world map drawn from country borders only: no tiles, terrain, roads or regional detail
- [x] Pastel countries with thick friendly outlines, a dotted ocean and atlas lines (Equator and tropics)
- [x] Country names and cities appear as you zoom in, more at every zoom step, with labels that never overlap
- [x] Capitals marked with a star; smaller towns appear as you zoom in
- [x] Visited countries turn teal, wishlist countries turn sunny yellow with a dashed border
- [x] Countries you only visited a city in get a lighter teal
- [x] Map legend doubles as a filter for visited and wishlist places
- [x] Works offline from the server: map data and fonts are bundled, no third-party tiles

### Places
- [x] Click any country or city for a card with flag, capital, population and your saved details
- [x] One tap to mark a place as "Been there" or "Wishlist" (tap again to undo)
- [x] Search countries and about 7,000 cities instantly, with a world search fallback for smaller towns
- [x] Notes, travel dates and photo links on every place
- [x] Places list grouped by continent, with filters, search and sorting
- [x] Undo after removing a place
- [x] Import and export as JSON or CSV (duplicates are skipped on import)
- [x] "Surprise me" flies you to a country you have not visited yet

### Trips
- [x] Plan trips with morning, afternoon and evening slots for up to 30 days
- [x] Itineraries are pre-filled with sights, activities and food ideas from Wikivoyage
- [x] Travel ideas panel for any country or city
- [x] Copy an itinerary as text

### Passport
- [x] Traveler rank and progress to the next rank
- [x] Countries visited, share of the world, continents, cities and trips
- [x] Per-continent progress bars
- [x] Passport stamps for every visited country
- [x] 12 badges to unlock, with a confetti celebration
- [x] Trips by year chart

### Account and sharing
- [x] Username and password accounts
- [x] Public or private travel map, with a read-only share link (`/?u=username`); notes and photos stay private
- [x] Responsive layout with a bottom sheet on phones, keyboard shortcuts (`/` to search) and screen reader labels
- [x] Light and dark themes that follow the system setting

### Next
- [ ] Google and Facebook login
- [ ] Travel albums: give each pinned place a description and a photo album instead of a single photo link
- [ ] Multiple visits per place: record each visit with its own dates, description and photos, and show how many times you have been

## Map Requirements

- Keep the map simple and focused on travel tracking.
- Show only countries borders, not regions or other subdivisions.
- Avoid too much detailed terrain and map noise.
- Show more city-level detail only when zoomed in.
- Fun and cartoonish, but still usable and polished.

## Project structure

```text
src/                   Express API (auth, places, trips, public maps, geocoding)
  db/migrations/       Versioned PostgreSQL schema
public/                Everything the browser loads (the only folder served)
  index.html           App shell
  styles.css           Cartoon design system
  js/app.js            App wiring: auth, map cards, search, tabs
  js/map.js            Leaflet map: countries, labels, cities and pins
  js/geo.js            Country lookup, stats, ranks and badges (pure, unit tested)
  js/places.js         Places tab and import/export
  js/trips.js          Trip planner
  js/passport.js       Passport tab
  js/ideas.js          Wikivoyage ideas and itinerary builder
  data/                Country borders and cities (Natural Earth, public domain)
  vendor/              Leaflet and fonts (Fredoka, Nunito; SIL OFL)
scripts/build-map-data.js  Rebuilds public/data from Natural Earth
test/                  Unit, integration (PostgreSQL) and Playwright tests
infra/                 bm-cluster deployment (Argo CD, Kubernetes, compose, CI scripts)
```

### Rebuilding the map data

Download `ne_50m_admin_0_countries.geojson` and `ne_10m_populated_places_simple.geojson` from
[Natural Earth](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson) into a folder, then run:

```bash
node scripts/build-map-data.js path/to/folder
```

## Architecture

| Layer | Details |
| --- | --- |
| Frontend | Static ES modules in `public/`; Leaflet, fonts and Natural Earth map data are bundled, so there are no third-party tiles. |
| API | Express 5 in `src/`, JSON routes under `/api`, Passport username/password login with bcrypt (cost 12). |
| Data | PostgreSQL with versioned SQL migrations in `src/db/migrations/`, applied at startup under an advisory lock. Sessions are stored in PostgreSQL, so replicas are stateless. |
| Geocoding | `/api/geocode` proxies Nominatim server-side with caching, throttling and an identifying User-Agent. |
| Operations | JSON logs (pino) on stdout, Prometheus metrics on a separate port (`/metrics` on 9464), `/healthz` liveness and `/readyz` readiness, graceful shutdown on SIGTERM. |

### Security controls

- Only `public/` is served; source, configuration and databases are never reachable over HTTP.
- Strict Content Security Policy and security headers (helmet); no inline scripts or styles.
- CSRF protection with a per-session synchronizer token (`GET /api/csrf-token`, sent as `X-CSRF-Token`).
- `HttpOnly`, `SameSite=Lax` session cookies, `Secure` in production; session regenerated on login.
- Rate limits on authentication, the API and geocoding; constant-time login responses for unknown users.
- Production refuses to start without a 32+ character `SESSION_SECRET`.
- Non-root, read-only-filesystem container image.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/csrf-token` | CSRF token for the current session |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Account and session management |
| GET | `/api/auth/me` | Current user |
| GET, POST | `/api/markers` | List or create saved places |
| POST | `/api/markers/import` | Bulk import up to 1,000 places |
| PATCH, DELETE | `/api/markers/:id` | Update or remove a place |
| GET, POST | `/api/trips` | List or create trip itineraries |
| PUT, DELETE | `/api/trips/:id` | Update or remove a trip |
| PATCH | `/api/profile` | Set profile visibility (`private` or `public`) |
| GET | `/api/public/:username` | Public read-only map (notes and photos stay private) |
| GET | `/api/geocode?q=&kind=city\|country` | Place search |

## Run locally

Requires Node.js 22.12 or newer and PostgreSQL (or Docker).

```bash
docker compose -f infra/compose/compose.yaml up -d postgres
cp .env.example .env   # adjust if needed
npm ci
DATABASE_URL=postgres://travelmapster:travelmapster@localhost:5432/travelmapster npm run dev
```

Then open http://localhost:3000. To run the whole stack in containers instead:
`docker compose -f infra/compose/compose.yaml up --build`.

### Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | – | Or the standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`. |
| `SESSION_SECRET` | dev-only value | Required (32+ characters) when `NODE_ENV=production`. |
| `PORT` / `METRICS_PORT` | `3000` / `9464` | |
| `TRUST_PROXY` | `false` | `true`, a hop count, or CIDRs of the reverse proxy. |
| `LOG_LEVEL` | `info` | |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_API`, `RATE_LIMIT_GEOCODE` | `10`/15 min, `300`/min, `30`/min | Per client IP. |
| `GEOCODER_URL`, `GEOCODER_USER_AGENT` | Nominatim | Set a contact URL in the User-Agent for production. |

## Quality checks

```bash
npm run lint            # ESLint
npm test                # unit + integration tests (needs PostgreSQL; set DATABASE_URL or TEST_DATABASE_URL)
npm run test:coverage   # same, with an 80% line-coverage gate and coverage/lcov.info
npm run test:e2e        # Playwright browser tests against a real server
```

GitHub Actions runs lint, tests with coverage, `npm audit`, the browser tests, and a Trivy scan
of the container image on every push and pull request.

On GitLab, the SonarQube analysis (`01-quality`) runs on the default branch and in `PIPELINE_MODE=full`
pipelines, and is a manual job on other branches and merge requests. bm-cluster's Sonar discovery
also runs it periodically through a `SONAR_SCAN_ONLY=true` pipeline.

## Deploy to bm-cluster

The repository follows the [bm-cluster application contract](https://github.com/chefzaid/bm-cluster/blob/main/docs/application-onboarding.md)
(version 1). Onboard it from a bm-cluster control-plane host with `./add-repos.sh` and select
`travelmapster` for deployment. Onboarding imports the repository into GitLab, generates the
database password and session secret in Vault (`apps/travelmapster/runtime`), creates DNS for
the chosen subdomain, and runs the GitLab release pipeline.

| Path | Purpose |
| --- | --- |
| `infra/onboarding.json` | Onboarding contract: inputs, rendered files, Vault secrets, DNS, required jobs |
| `infra/argocd/application.yaml` | Argo CD Application (namespace `apps`, auto-sync) |
| `infra/k8s/` | Deployment, Service, Ingress, NetworkPolicy, ExternalSecrets, database setup hook |
| `infra/overlays/ha/` | Two replicas, PodDisruptionBudget and host spreading for HA clusters |
| `.gitlab-ci.yml`, `infra/scripts/` | Test, image build (Kaniko), release tagging, Argo CD deploy and smoke checks |

After onboarding, releases start with the manual `00-image` job on the default branch, which
publishes the container image. `01-release` then commits and tags the version, and `02-deploy`
waits for Argo CD to report the exact release revision as Synced and Healthy.

