# Development Guide

## Repository Layout

```text
src/                     Express API; see architecture.md for each module
  db/migrations/         Versioned PostgreSQL schema
public/                  Everything the browser loads (the only folder served)
  js/                    Native ES modules, no build step
  data/                  Country borders and cities (Natural Earth)
  vendor/                MapLibre GL (BSD-3-Clause) and fonts (Fredoka, Nunito; SIL OFL)
scripts/build-map-data.js  Rebuilds public/data
test/                    Unit, integration and Playwright tests
infra/                   Compose stack, Kubernetes, Argo CD and CI scripts
docs/                    Guides and ADRs
```

## Toolchain

Node.js 22.12 or newer (`.nvmrc` pins 22) and PostgreSQL 18, or Docker for both. The
[dev container](../.devcontainer/devcontainer.json) installs dependencies and starts the
compose database.

## Local Start

Full stack in containers (app on port 3000, PostgreSQL on 5432):

```bash
docker compose -f infra/compose/compose.yaml up --build
```

Fast edit loop, restarting on file changes:

```bash
docker compose -f infra/compose/compose.yaml up -d postgres
npm ci
cp .env.example .env
npm run dev
```

`npm run dev` and `npm run migrate` load `.env` when it exists; `npm start` (production) reads
only the process environment. Frontend changes need only a browser reload. Migrations run at
startup. The compose database also creates `travelmapster_test` for the
[tests](testing.md#test-database) on first start.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | – | Or `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` |
| `DATABASE_POOL_MAX` | `10` | Connections per process |
| `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED` | off, `true` | TLS to PostgreSQL |
| `SESSION_SECRET` | development value | Required, 32+ characters, when `NODE_ENV=production` |
| `SESSION_MAX_AGE_HOURS` | `168` | Rolling session lifetime |
| `SESSION_COOKIE_NAME`, `SESSION_SECURE_COOKIE` | `travelmapster.sid`, production only | |
| `PORT`, `METRICS_PORT` | `3000`, `9464` | |
| `NODE_ENV`, `LOG_LEVEL` | `development`, `info` | `test` silences logs |
| `TRUST_PROXY` | `false` | `true`, a hop count or reverse-proxy CIDRs; needed for correct client IPs |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_API`, `RATE_LIMIT_GEOCODE` | `10`/15 min, `300`/min, `30`/min | Per client IP, shared by all replicas; auth covers sign-in, sign-up and account changes |
| `GEOCODER_URL`, `GEOCODER_USER_AGENT` | Nominatim | Put a contact URL in the User-Agent |
| `GEOCODER_MIN_INTERVAL_MS`, `GEOCODER_TIMEOUT_MS`, `GEOCODER_CACHE_SIZE` | `1100`, `8000`, `1000` | Nominatim usage policy |

Invalid integers stop startup with a clear error. Production values come from
[Kubernetes](deployment.md#kubernetes-resources).

## Adding A Capability

- **API**: add limits to `validation.js`, SQL to `repositories.js` (scoped to `req.user.id`),
  a route under `src/routes/`, integration tests, and a new migration if the schema changes.
- **Frontend**: add an ES module under `public/js/`; keep logic that can be pure in `geo.js`
  or `io.js` so it is unit tested; use the colour tokens in `styles.css` so both themes keep
  [AA contrast](features.md#product-principles).
- **Third-party calls** need a CSP change in `src/app.js` and a [security](security.md) review.

## Rebuilding Map Data

Download `ne_50m_admin_0_countries.geojson` and `ne_10m_populated_places_simple.geojson` from
[Natural Earth](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson) and unzip
[GeoNames `cities500.zip`](https://download.geonames.org/export/dump/) into one folder, then:

```bash
node scripts/build-map-data.js path/to/folder
```

It takes about ten seconds. Review the size and the [data format](data-model.md#map-data)
before committing.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Database not ready, retrying migrations` | PostgreSQL is running and `DATABASE_URL` is right; startup gives up after ten attempts. |
| `SESSION_SECRET must be set…` | Set a 32+ character secret, or use a non-production `NODE_ENV` locally. |
| Writes fail with `Invalid or missing CSRF token` | The client must send the token from `/api/csrf-token`; it changes after login and logout. |
| Sign-ups return 429 | The auth limit is 10 per 15 minutes per IP and survives restarts; raise `RATE_LIMIT_AUTH` locally or run `DELETE FROM rate_limits`. |
| Port 3000, 3100 or 5432 in use | Stop the other process or change `PORT`, `E2E_PORT` or the compose port. |
