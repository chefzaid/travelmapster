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
- Changing the password or deleting the account requires the current password and shares the
  sign-in rate limit. A password change starts a new session and ends all others; deletion ends
  every session.
- Production refuses to start without a `SESSION_SECRET` of at least 32 characters.

## Authorization

Every place, visit, ledger, trip and profile route requires a session, and every query is scoped
to the signed-in user (visits through the place they belong to), so another user's IDs return
404 and ledger settings and date history are only ever the caller's own. Public maps are read-only and exist only when
their owner chose `public`; private and missing profiles return the same 404.

## Request Protection

- **CSRF**: unsafe methods need `X-CSRF-Token`, a per-session random token compared in constant
  time.
- **Validation**: every body is checked in `src/validation.js` (lengths, types, calendar dates,
  visit end dates on or after the start, HTTP(S)-only photo links, ratings, tags and single emoji, trip size, visits per place, bulk changes of at most 300 places,
  ledger rule and planned-stay limits); bodies are limited to 100 KB, or 3 MB for imports.
- **Rate limits** per client IP on sign-in and sign-up, the API and place search
  ([defaults](development.md#configuration)), with standard `RateLimit` headers; counters live
  in PostgreSQL, so the limit holds across replicas. Sign-ups have their own, tighter limit per
  hour on top of the sign-in one.
- **Sign-up bots**: the sign-up form carries a honeypot field that is hidden from people and
  screen readers; a sign-up that fills it in is refused without creating an account. There is
  no third-party captcha.
- **Headers** (helmet): CSP allowing only same-origin scripts and styles (no inline), no framing,
  HSTS in production, no `X-Powered-By`. API responses are `Cache-Control: no-store`.
- Only `public/` is served statically; source, configuration and dependencies are never reachable.
- Public pages (the landing page and the Schengen calculator) run under the same CSP; the
  calculator makes no API call and stores nothing, and changes on the landing page's demo map
  never reach the API ([ADR 0011](adr/0011-public-pages.md)).

## Privacy

- Notes and photo links, of places and of visits, and ratings, tags, emoji and wishlist plans
  of places are never included in public maps; only visit dates are ([ADR 0012](adr/0012-place-details.md)).
  Places the traveler hid from the public map are left out by the query itself, with their
  visits; a replica of a release before that change would list them, so rollbacks below it
  are avoided ([ADR 0013](adr/0013-hidden-places.md)). Shared maps are sent with `X-Robots-Tag: noindex` and left out of the
  sitemap, so search engines do not list them. Whether a stay is still going on is never shared either, as it would tell
  where the traveler is now, and neither are the home country ([ADR 0014](adr/0014-home-lived-and-transit.md)),
  ledger settings or the date history. Whether a shared place was lived in or a layover is shown,
  like its status. Journey lines, which make the order of trips obvious, are drawn for visitors
  only when the owner turns them on ([ADR 0016](adr/0016-timeline-journeys-and-palettes.md)).
- Places are stored at town or country level: the app saves the bundled map coordinates of a
  town or a country label, and a place from the world search is rounded to two decimals (about
  a kilometer). Only an import keeps the coordinates written in the file, as the traveler chose
  them. The Ledger tab states this, with the rules below ([ADR 0017](adr/0017-product-principles.md)).
- Day counts, alerts and evidence reports are computed in the browser and only when the
  traveler opens the Ledger tab or asks for a report ([ADR 0010](adr/0010-day-ledger.md)); reports
  are never sent to the server.
  Evidence CSV files defuse cells that a spreadsheet would run as formulas.
- The history of visit dates is append-only through the API: it is written by database
  triggers and deleted only with the account.
- The browser loads photo links from their hosts and sends destination names to Wikivoyage for
  ideas; both are visible to those third parties.
- Logs carry user IDs, never passwords, cookies or tokens.
- Product metrics are aggregate Prometheus counters and gauges with no user in their labels;
  the only activity stored per account is the date it was last used
  ([ADR 0018](adr/0018-product-metrics.md)). There is no third-party analytics.
- Travelers can download everything their account holds as one archive (`GET /api/export`,
  only ever the caller's own data, never the password hash) and delete their account, which
  removes all their data at once ([data model](data-model.md#privacy)).

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
