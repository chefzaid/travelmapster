# Testing Guide

## Test Layers

| Layer | Location | Runs against |
|---|---|---|
| Unit | `test/unit/` | Config, CSRF, geocoder and validation, without I/O |
| Frontend logic | `test/frontend.test.js`, `test/days.test.js`, `test/schengen.test.js`, `test/map.test.js`, `test/memories.test.js`, `test/travel-stats.test.js`, `test/itinerary.test.js`, `test/archive.test.js` | Pure browser modules (`geo.js`, `status.js`, `lists.js`, `io.js`, `visits.js`, `details.js`, `bulk.js`, `ideas.js`, `demo.js`, `timeline.js`, `journeys.js`, `palettes.js`, `memories.js`, `travel-stats.js`, `itinerary.js`, `archive.js`, `zip.js`) and the map data, including every tile and the UN country list, and the calculator page's member list; `days.test.js` covers the day ledger with Schengen 90/180 cases and seeded property tests (leap years, overnight border crossings, open-ended stays, sliding windows); `schengen.test.js` covers the public calculator, with a property test that its latest day to stay is exactly right; `map.test.js` covers the timeline and journey lines, and reads the palette tokens from `css/tokens.css` to check label contrast and that statuses stay apart for simulated color-blind vision and in grayscale |
| Integration | `test/integration/` | The real Express app and PostgreSQL through Supertest, with a fake geocoder; `visits.test.js` also replays the previous release's writes and migrates a copy of the previous schema, and `ledger.test.js` covers ledger settings and the date history its triggers write |
| Browser | `test/e2e/travel.spec.js`, `test/e2e/public.spec.js` | Playwright Chromium against a real server: the Schengen calculator without an account (and without any API call), the landing page's demo map (nothing saved) and its sign-up links, sign-up, marking a city, recording several visits (and an "On this day" memory and the passport's travel statistics), the day ledger (Schengen days, a planned stay, a threshold alert, the evidence report and its CSV), sharing (a hidden place disappears for visitors), marking several countries and a continent at once in one request each with undo, a home country with a city lived in and a layover counted apart and the UN country list, the timeline with the keyboard, journey lines and their replay, a color-blind palette, journey lines on a public map only once the owner shares them and printing the map, login errors, trip planning (from a wishlist place, calendar export, a planned stay in the ledger that follows the trip, recording a past trip as a visit, the printable itinerary and duplicating a trip), password change, downloading the account archive and a KML file, account deletion and clicking a town drawn on the map |
| Accessibility | `test/e2e/accessibility.spec.js` | axe WCAG 2.2 A/AA rules, including contrast and target size, on every screen in light and dark themes, with reduced motion so nothing is audited mid-fade, including the ledger's rule dialog and evidence report, the trip editor and the printable itinerary, the place details dialog, a transit-only place card, the settings dialog, the places list filtered by tag, the country picking bar, the timeline with journey lines after a replay, a place card and the passport in the color-blind and print palettes, a public map with the timeline and its palette choice, the landing page with a demo card and the calculator with an overstay and a faulty row |

## Test Database

Integration tests **drop and recreate the `public` schema** of their database, so they refuse
to run unless the database name contains `test`. The compose database creates
`travelmapster_test`, and the dev container points `TEST_DATABASE_URL` at it. Otherwise start a
disposable one:

```bash
docker run -d --rm --name travelmapster-test -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=travelmapster_test -p 127.0.0.1:55432:5432 postgres:18-bookworm
```

Tests use `TEST_DATABASE_URL`, then `DATABASE_URL`, then
`postgres://postgres@127.0.0.1:55432/travelmapster_test`.

## Commands

```bash
npm run lint            # ESLint
npm test                # unit, frontend and integration tests
npm run test:unit       # unit tests only, no database
npm run test:coverage   # same as npm test with an 80% line-coverage gate and coverage/lcov.info
npm run test:e2e        # Playwright; starts its own server on E2E_PORT (3100)
```

The browser suites use `E2E_DATABASE_URL`, then `TEST_DATABASE_URL`, then the default above, never
`DATABASE_URL`; run `npx playwright install chromium` once. They keep existing data and raise the
auth rate limit, whose counters persist between runs.

## Continuous Integration

| Where | What runs |
|---|---|
| GitHub Actions ([ci.yml](../.github/workflows/ci.yml)), every push to `main` and pull request | Lint, coverage, `npm audit`, Playwright journeys and accessibility, then an image build scanned by Trivy (HIGH/CRITICAL fail) |
| GitLab `01-test`, every branch | Lint, coverage (artifact for Sonar) and `npm audit` |
| GitLab `02-package` | Builds the image without pushing |
| GitLab `01-quality`, `02-security` | Sonar and Trivy reports; non-blocking ([code quality](code-quality.md)) |

Dependabot proposes weekly npm and monthly GitHub Actions and Docker updates.

## Writing Tests

- Start at the narrowest layer: pure logic in unit or frontend tests, HTTP contracts in
  integration tests, and only critical journeys in Playwright.
- Property tests use a small seeded generator in the test file, so a failure reproduces with
  the same seed; no extra dependency.
- Integration tests use `createTestContext()` and `createClient()` from `test/helpers.js`, which
  wire the app exactly like production and handle the CSRF token.
- Cover the failure paths the API promises: validation errors, 401, 403 (CSRF), 404 for other
  users' data, and rate limits.
- Keep Playwright hermetic: stub third-party calls such as Wikivoyage, and audit animated UI
  such as map cards only once it has settled.
- New screens and dialogs belong in the accessibility suite.

## Known Gaps

No visual-regression or load tests.
