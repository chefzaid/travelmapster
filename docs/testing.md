# Testing Guide

## Test Layers

| Layer | Location | Runs against |
|---|---|---|
| Unit | `test/unit/` | Config, CSRF, geocoder and validation, without I/O |
| Frontend logic | `test/frontend.test.js` | Pure browser modules (`geo.js`, `io.js`, `ideas.js`) and the map data |
| Integration | `test/integration/` | The real Express app and PostgreSQL through Supertest, with a fake geocoder |
| Browser | `test/e2e/` | Playwright Chromium against a real server: sign-up, marking a city, sharing, login errors and trip planning |

## Test Database

Integration tests **drop and recreate the `public` schema** of their database. Always point them
at a disposable database, never at development or production data:

```bash
docker run -d --rm --name travelmapster-test -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=travelmapster_test -p 127.0.0.1:55432:5432 postgres:18-bookworm
```

Tests use `TEST_DATABASE_URL`, then `DATABASE_URL`, then
`postgres://postgres@127.0.0.1:55432/travelmapster_test`. The dev container sets
`DATABASE_URL` to the development database, so set `TEST_DATABASE_URL` there before testing.

## Commands

```bash
npm run lint            # ESLint
npm test                # unit, frontend and integration tests
npm run test:unit       # unit tests only, no database
npm run test:coverage   # same as npm test with an 80% line-coverage gate and coverage/lcov.info
npm run test:e2e        # Playwright; starts its own server on E2E_PORT (3100)
```

The browser suite uses `E2E_DATABASE_URL` (falling back to `DATABASE_URL` and the default above);
run `npx playwright install chromium` once. It does not reset the schema.

## Continuous Integration

| Where | What runs |
|---|---|
| GitHub Actions ([ci.yml](../.github/workflows/ci.yml)), every push to `main` and pull request | Lint, coverage, `npm audit`, Playwright, then an image build scanned by Trivy (HIGH/CRITICAL fail) |
| GitLab `01-test`, every branch | Lint, coverage (artifact for Sonar) and `npm audit` |
| GitLab `02-package` | Builds the image without pushing |
| GitLab `01-quality`, `02-security` | Sonar and Trivy reports; non-blocking ([code quality](code-quality.md)) |

Dependabot proposes weekly npm and monthly GitHub Actions and Docker updates.

## Writing Tests

- Start at the narrowest layer: pure logic in unit or frontend tests, HTTP contracts in
  integration tests, and only critical journeys in Playwright.
- Integration tests use `createTestContext()` and `createClient()` from `test/helpers.js`, which
  wire the app exactly like production and handle the CSRF token.
- Cover the failure paths the API promises: validation errors, 401, 403 (CSRF), 404 for other
  users' data, and rate limits.
- Keep Playwright hermetic: stub third-party calls such as Wikivoyage.

## Known Gaps

No automated accessibility, visual-regression or load tests yet ([roadmap](../TODO.md)).
