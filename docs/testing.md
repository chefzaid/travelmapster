# Testing Guide

## Test Layers

| Layer | Location | Runs against |
|---|---|---|
| Unit | `test/unit/` | Config, CSRF, geocoder, validation, TOTP codes, the map picture and sitemap, the employer's report, and the OpenAPI description against the routes the app mounts, without I/O |
| Frontend logic | `test/*.test.js` | Pure browser modules (`geo.js`, `status.js`, `lists.js`, `io.js`, `visits.js`, `details.js`, `bulk.js`, `ideas.js`, `demo.js`, `timeline.js`, `journeys.js`, `palettes.js`, `memories.js`, `travel-stats.js`, `itinerary.js`, `archive.js`, `zip.js`, `goals.js`, `collections.js`, `imports.js`, `zip-read.js`, `poster.js`, `share-cards.js`, `ledger-evidence.js`, `ledger-rules.js`, `exif.js`, `towns.js`, `auto-import.js`, `guest-api.js`, `qr.js`, `webauthn.js`, `compare.js`, `trip-budget.js`, `trip-stops.js`, `org-data.js`, `ledger-org.js`, `i18n.js`, `travel-history.js`, `heat-map.js`), every translation catalog against the keys in the code and the pages (`i18n.test.js`, with plural forms per language and the countries' localized names) and the map data, including every tile and the UN country list, and the calculator page's member list; `days.test.js` covers the day ledger with Schengen 90/180 cases and seeded property tests (leap years, overnight border crossings, open-ended stays, sliding windows); `schengen.test.js` covers the public calculator, with a property test that its latest day to stay is exactly right; `map.test.js` covers the timeline and journey lines, and reads the palette tokens from `css/tokens.css` to check label contrast and that statuses, and the steps of days on the map, stay apart for simulated color-blind vision and in grayscale |
| Integration | `test/integration/` | The real Express app and PostgreSQL through Supertest, with a fake geocoder; `visits.test.js` also replays the previous release's writes and migrates a copy of the previous schema, `ledger.test.js` covers ledger settings and the date history its triggers write, `orgs.test.js` covers organization roles, invitation links, business visits, the second factor managers need, the report (business days only) and its audit log, and `checklists.test.js` the checklist before trips and business trips |
| Offline | `test/e2e/offline.spec.js` | With the service worker, which the other suites block: the app opens offline with the places last loaded, a change made offline is refused with a message, and signing out leaves nothing to show offline |
| Performance | `test/e2e/performance.spec.js` | The landing page on a mid-range phone (Moto G4 screen, 4x slower CPU, slow 4G at 150 ms and 1.6 Mbps), within the budget in `test/e2e/performance-budget.json`: page weight and map data as transferred, Largest Contentful Paint and Cumulative Layout Shift |
| Browser | `test/e2e/travel.spec.js`, `ledger.spec.js`, `trips.spec.js`, `account.spec.js`, `map.spec.js`, `import.spec.js`, `public.spec.js`, `guest.spec.js`, `security.spec.js`, `friends.spec.js`, `orgs.spec.js`, `checklists.spec.js`, with shared steps in `test/e2e/helpers.js` | Playwright Chromium against a real server: the Schengen calculator without an account (and without any API call), the landing page's demo map (nothing saved) and its sign-up links, sign-up, marking a city, copying the passport's flags, recording several visits (a country not seen for years, an "On this day" memory, the passport's travel statistics and streaks, a yearly goal reached and a picture of the year's recap), the day ledger (days on the map, Schengen days, a planned stay, a threshold alert, the evidence report and its CSV), sharing (a hidden place disappears for visitors, and the embeddable map in another page's frame), marking several countries and a continent at once in one request each with undo, a home country with a city lived in and a layover counted apart and the UN country list, the side panel folded away and opened again, the timeline with the keyboard, journey lines and their replay, a color-blind palette, journey lines on a public map only once the owner shares them and printing the map, login errors, trip planning (from a wishlist place, calendar export, a planned stay in the ledger that follows the trip, recording a past trip as a visit, the printable itinerary and duplicating a trip), password change, downloading the account archive, a poster and a KML file, account deletion, importing a pasted country list and a Polarsteps export after a preview, clicking a town drawn on the map, a guest map moved into an account, passkeys and two-step sign-in, following and comparing maps and a trip planned together, and an organization: two-step sign-in to create it, an employer rule, an invitation link opened signed out, a business trip counted against the rule in the Ledger tab, the report and its CSV, and the audit entry the traveler sees, and a business trip that lists the organization's task before going, adds it to the packing list and counts it down until ticked off. The landing page shows before the map is drawn, so journeys wait for `#app[data-map="ready"]` before using the map |
| Accessibility | `test/e2e/accessibility.spec.js` | axe WCAG 2.2 A/AA rules, including contrast and target size, on every screen in light and dark themes, with reduced motion so nothing is audited mid-fade, including the ledger's rule dialog and evidence report, the goal dialog and a passport with a goal, the trip editor and the printable itinerary, the place details dialog, a transit-only place card, the settings dialog, the places list filtered by tag, the country picking bar, the timeline with journey lines after a replay, a place card and the passport in the color-blind and print palettes, a public map with the timeline and its palette choice, the embeddable map, the landing page with a demo card, the calculator with an overstay and a faulty row, the sign-in security and two-step setup dialogs, the organizations dialog and an organization's report, and a business trip with its checklist |

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
npm run typecheck       # TypeScript checks the JavaScript and its JSDoc, emitting nothing
npm test                # unit, frontend and integration tests
npm run test:unit       # unit tests only, no database
npm run test:coverage   # same as npm test with an 80% line-coverage gate and coverage/lcov.info
npm run test:e2e        # Playwright, with the performance budget; starts its own server on E2E_PORT (3100)
```

The browser suites use `E2E_DATABASE_URL`, then `TEST_DATABASE_URL`, then the default above, never
`DATABASE_URL`; run `npx playwright install chromium` once. They keep existing data and raise the
auth rate limit, whose counters persist between runs.

## Continuous Integration

| Where | What runs |
|---|---|
| GitHub Actions ([ci.yml](../.github/workflows/ci.yml)), every push to `main` and pull request | Lint, type check, coverage, `npm audit`, Playwright journeys, accessibility and the performance budget, then an image build scanned by Trivy (HIGH/CRITICAL fail) |
| GitLab `01-test`, every branch | Lint, type check, coverage (artifact for Sonar) and `npm audit` |
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

No visual-regression or load tests. The performance budget covers the first visit to the landing
page only.
