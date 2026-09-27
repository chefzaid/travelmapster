# ADR 0003: Local Accounts With Server-Side Sessions And CSRF Tokens

- Status: Accepted
- Date: 2026-09-27

## Context

Travelers need a simple username and password account. The browser and API share one origin,
and the app may run as several replicas.

## Decision

Passport's local strategy authenticates against bcrypt hashes (cost 12). Sessions are stored in
PostgreSQL (`connect-pg-simple`) behind an `HttpOnly`, `SameSite=Lax` cookie. Unsafe requests
carry a synchronizer CSRF token from `/api/csrf-token` in `X-CSRF-Token`. See the
[security reference](../security.md#authentication-and-sessions).

## Consequences

- No tokens in browser storage, sessions can be revoked, and replicas stay stateless.
- Every request reads the session from PostgreSQL; the `sessions` table is pruned every
  15 minutes.
- Social login (on the roadmap) must link to these accounts rather than replace them, and
  would need a new ADR.
