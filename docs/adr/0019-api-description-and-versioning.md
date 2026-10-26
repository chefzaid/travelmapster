# ADR 0019: Describe The API In OpenAPI And Keep Version 1 Compatible

- Status: Accepted
- Date: 2026-10-26

## Context

The JSON API under `/api` was described only in a table in the architecture guide. Mobile apps
and Teams integrations, both on the roadmap, need a machine-readable description, and they
cannot be updated together with the server: a phone keeps an old app for months, as a browser
tab keeps old scripts until it reloads, which the API already tolerates during rollouts
([ADR 0009](0009-places-and-visits.md)).

## Decision

- **Description.** `docs/api/openapi.json` describes every route in OpenAPI 3.1: parameters,
  bodies, limits, responses, the session cookie and the CSRF header. A unit test reads the
  routes from `src/app.js` and `src/routes/` and fails when a route is missing from the file or
  the file lists one the app does not serve, and checks that every reference resolves.
- **Versioning.** The API is version 1, at `/api`. Within it, changes are backward compatible
  only: new routes, new optional request fields, new response fields, and new values only where
  a client must already expect them. Never removed or renamed fields, a changed type or meaning,
  a newly required field or tighter limits on an existing one. `info.version` follows semantic
  versioning: the minor number grows with additions, the patch number with fixes to the
  description.
- **Breaking changes.** A change that cannot be compatible goes to a new major version beside
  the old one, at `/api/v2`. The old version keeps working for at least six months after the
  new one ships, and its responses carry `Deprecation` and `Sunset` headers in the meantime.

## Consequences

- Every change to a route changes `docs/api/openapi.json` in the same commit, or the tests fail.
- The legacy `travelDate` field stays accepted in version 1 as an import field, as ADR 0009
  already decided; it is marked deprecated in the description.
- Clients can generate code from the description; its schemas mirror `src/validation.js` but
  are not used to validate requests, so the validation module stays the source of truth.
