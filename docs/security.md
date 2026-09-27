# Security Reference

## Trust Boundaries

| Boundary | Control |
|---|---|
| Browser → app | HTTPS at Traefik, strict CSP, session cookie, CSRF token, rate limits |
| App → PostgreSQL | Dedicated `travelmapster_user` role owning only the `travelmapster` database; `CONNECT` revoked from `PUBLIC` |
| App → Nominatim | Server-side only, with a fixed User-Agent, throttling and a timeout |
| Browser → Wikivoyage | Read-only public API, allowed by CSP `connect-src` |
| Cluster → pod | NetworkPolicy admits only Traefik, Prometheus and CI smoke tests |

## Authentication And Sessions

- Local accounts ([ADR 0003](adr/0003-sessions-and-csrf.md)): usernames are unique regardless of
  case; passwords of 8–72 bytes are hashed with bcrypt at cost 12. Unknown usernames are still
  compared against a dummy hash so timing does not reveal which accounts exist.
- Sessions live in PostgreSQL. The cookie is `HttpOnly`, `SameSite=Lax` and `Secure` in
  production, and rolls over a 7-day lifetime. Login regenerates the session to prevent
  fixation; deleted users are logged out on their next request.
- Production refuses to start without a `SESSION_SECRET` of at least 32 characters.

## Authorization

Every place, trip and profile route requires a session, and every query is scoped to the
signed-in user, so another user's IDs return 404. Public maps are read-only and exist only when
their owner chose `public`; private and missing profiles return the same 404.

## Request Protection

- **CSRF**: unsafe methods need `X-CSRF-Token`, a per-session random token compared in constant
  time.
- **Validation**: every body is checked in `src/validation.js` (lengths, types, calendar dates,
  HTTP(S)-only photo links, trip size); bodies are limited to 100 KB, or 3 MB for imports.
- **Rate limits** per client IP on sign-in and sign-up, the API and place search
  ([defaults](development.md#configuration)), with standard `RateLimit` headers; counters are
  in memory per process.
- **Headers** (helmet): CSP allowing only same-origin scripts and styles (no inline), no framing,
  HSTS in production, no `X-Powered-By`. API responses are `Cache-Control: no-store`.
- Only `public/` is served statically; source, configuration and dependencies are never reachable.

## Privacy

- Notes and photo links are never included in public maps.
- The browser loads photo links from their hosts and sends destination names to Wikivoyage for
  ideas; both are visible to those third parties.
- Logs carry user IDs, never passwords, cookies or tokens.
- Account deletion is not available yet ([roadmap](../TODO.md)); deleting a user row cascades to
  all their data ([data model](data-model.md#privacy)).

## Runtime And Supply Chain

- The image runs Node.js only, as user 10001, with a read-only root filesystem, all Linux
  capabilities dropped and no service-account token; npm is removed from the runtime image and
  Debian packages are upgraded at build time.
- Secrets come from Vault through External Secrets; none are committed
  ([rotation](operations.md#secret-rotation)).
- `npm audit`, Trivy (repository and image) and Dependabot run in CI
  ([testing](testing.md#continuous-integration), [code quality](code-quality.md#trivy)); the
  base image and GitLab CI images are pinned by digest.

## Review Checklist

- New input is validated in `validation.js` and limited in the schema.
- New routes use `requireAuth` and user-scoped queries, and unsafe methods stay behind CSRF.
- New third-party origins are justified and added to the CSP deliberately.
- No secret, personal data or credential appears in logs, fixtures or commits.
