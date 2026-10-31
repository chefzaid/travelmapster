# Development Guide

## Repository Layout

```text
src/                     Express API; see architecture.md for each module
  db/migrations/         Versioned PostgreSQL schema
public/                  Everything the browser loads (the only folder served)
  js/                    Native ES modules, no build step
  data/                  Country borders and cities (Natural Earth)
  locales/               Translations of the interface, one catalog per language (ADR 0031)
  vendor/                MapLibre GL (BSD-3-Clause) and fonts (Fredoka, Nunito; SIL OFL)
scripts/build-map-data.js  Rebuilds public/data
scripts/i18n.js          Lists translation keys and checks or syncs the catalogs
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
| `TOTP_ENCRYPTION_KEY` | `SESSION_SECRET` | Optional key that encrypts two-step sign-in secrets ([ADR 0027](adr/0027-passkeys-and-two-step-sign-in.md)); set it to rotate `SESSION_SECRET` without affecting them |
| `SESSION_MAX_AGE_HOURS` | `168` | Rolling session lifetime |
| `SESSION_COOKIE_NAME`, `SESSION_SECURE_COOKIE` | `travelmapster.sid`, production only | |
| `PORT`, `METRICS_PORT` | `3000`, `9464` | |
| `NODE_ENV`, `LOG_LEVEL` | `development`, `info` | `test` silences logs |
| `TRUST_PROXY` | `false` | `true`, a hop count or reverse-proxy CIDRs; needed for correct client IPs |
| `PUBLIC_URL` | origin of each request | Public origin such as `https://travel.example.org`, used for absolute links in `robots.txt`, the sitemap and shared maps' link previews |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_API`, `RATE_LIMIT_GEOCODE` | `10`/15 min, `300`/min, `30`/min | Per client IP, shared by all replicas; auth covers sign-in, sign-up and account changes |
| `RATE_LIMIT_REGISTER` | `5`/hour | Sign-ups per client IP, on top of the auth limit; failed sign-ups count too |
| `RATE_LIMIT_PREVIEW` | `60`/min | Shared maps' link-preview pictures (`/og/<name>.png`) per client IP |
| `GEOCODER_URL`, `GEOCODER_USER_AGENT` | Nominatim | Put a contact URL in the User-Agent |
| `GEOCODER_MIN_INTERVAL_MS`, `GEOCODER_TIMEOUT_MS`, `GEOCODER_CACHE_SIZE` | `1100`, `8000`, `1000` | Nominatim usage policy |

Invalid integers stop startup with a clear error. Production values come from
[Kubernetes](deployment.md#kubernetes-resources).

## Adding A Capability

- **API**: add limits to `validation.js`, SQL to `repositories.js` (scoped to `req.user.id`),
  a route under `src/routes/`, integration tests, a new migration if the schema changes, and the
  route in [`docs/api/openapi.json`](api/openapi.json), keeping version 1 compatible
  ([ADR 0019](adr/0019-api-description-and-versioning.md)).
- **Frontend**: add an ES module under `public/js/`; keep logic that can be pure in `geo.js`
  or `io.js` so it is unit tested; use the colour tokens in `css/tokens.css` so both themes keep
  [AA contrast](features.md#product-principles).
- **Interface text** is English in the code, wrapped for translation
  ([ADR 0031](adr/0031-localization.md)): `t('Trip saved.')`, `t('Removed {name}.', { name })`,
  `tn(count, '{count} day', '{count} days')` for counts, `tk('…')` for text kept in a constant
  (translated with `t()` where it is shown, or from a getter), and `data-i18n`,
  `data-i18n-attr` or `data-i18n-parts` in the pages. Then run `node scripts/i18n.js sync`, which
  adds the new keys to `public/locales/*.json`, fill in each language, and check with
  `node scripts/i18n.js check`; a test fails while a catalog misses a key.
  `node scripts/i18n.js strings` lists literals that look like interface text but are not keys,
  including one-word labels handed to a function. Lists of names go through `formatList()`
  ("Lisbon and Porto") or `joinList()` (the language's own comma, for plain enumerations and
  field values), never `join(', ')`: Arabic writes `،`.
- **First page weight**: every module imported statically from `app.js` loads on the landing
  page. Import a feature that only runs after a click with `import()` where it is used (see
  `openSecurity` in `account.js`), and keep `start.js` to what the presentation needs.
- **Third-party calls** need a CSP change in `src/app.js` and a [security](security.md) review.

## App Icons

`node scripts/build-icons.js` renders the installable app's icons in `public/icons/` from
`public/logo.svg` with the bundled Chromium; run it after changing the logo.

## Rebuilding Map Data

Download `ne_50m_admin_0_countries.geojson`, `ne_50m_admin_0_map_subunits.geojson` and
`ne_10m_populated_places_simple.geojson` from
[Natural Earth](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson) and unzip
[GeoNames `cities500.zip`](https://download.geonames.org/export/dump/) into one folder, then:

```bash
node scripts/build-map-data.js path/to/folder
# or only the borders, from the two Natural Earth admin files, leaving the cities as they are:
node scripts/build-map-data.js path/to/folder --countries-only
```

The borders carry each country's name in the app's languages (`names`, from Natural Earth's
`NAME_FR`, `NAME_ES`, `NAME_DE` and `NAME_AR`). It takes about half a minute, the last part
writing a Brotli copy (`.br`) beside every data
file, which the server sends to browsers that accept it. After editing a data file by hand, run
`node scripts/compress-map-data.js`; a test fails while a copy is out of date. Review the size
and the [data format](data-model.md#map-data) before committing.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Database not ready, retrying migrations` | PostgreSQL is running and `DATABASE_URL` is right; startup gives up after ten attempts. |
| `SESSION_SECRET must be set…` | Set a 32+ character secret, or use a non-production `NODE_ENV` locally. |
| Writes fail with `Invalid or missing CSRF token` | The client must send the token from `/api/csrf-token`; it changes after login and logout. |
| Sign-ups return 429 | The sign-up limit is 5 per hour and the auth limit 10 per 15 minutes per IP, and both survive restarts; raise `RATE_LIMIT_REGISTER` and `RATE_LIMIT_AUTH` locally or run `DELETE FROM rate_limits`. |
| Port 3000, 3100 or 5432 in use | Stop the other process or change `PORT`, `E2E_PORT` or the compose port. |
