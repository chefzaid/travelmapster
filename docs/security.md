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
- **Passkeys** (WebAuthn, [ADR 0027](adr/0027-passkeys-and-two-step-sign-in.md)) must be
  discoverable and verify the user; registrations and sign-ins are checked by
  `@simplewebauthn/server` against a one-use challenge kept in the session for five minutes, the
  origin and the relying party (`PUBLIC_URL`'s host), and the signature counter is stored. The
  authenticator gets an opaque user handle, never the account number. A passkey sign-in needs no
  second step.
- **Two-step sign-in**: TOTP (RFC 6238, six digits, 30 seconds, one step either side, each step
  used once) after the password, for at most five minutes and five tries before the session
  opens; the secret is stored encrypted with AES-256-GCM under a key derived from
  `TOTP_ENCRYPTION_KEY` (or `SESSION_SECRET`), and the ten recovery codes as SHA-256 hashes.
  Turning it off needs the password; every route shares the sign-in rate limit.

## Authorization

Every place, visit, ledger, trip and profile route requires a session, and every query is scoped
to the signed-in user (visits through the place they belong to), so another user's IDs return
404 and ledger settings and date history are only ever the caller's own. Public maps are read-only and exist only when
their owner chose `public`; private and missing profiles return the same 404.

Organization routes check the caller's role in that organization on every request
([ADR 0029](adr/0029-organizations-and-business-days.md)): non-members get 404, travelers see
only their own organizations and rules, managers also the members and the report, and admins
also change members, invitations, rules and the organization itself. Managers and admins need a
passkey or two-step sign-in for any of that (403 `second_factor_required`), and so does
creating an organization. A visit or a trip can be marked as a business trip only for one of the
caller's own organizations, and only a trip's owner changes that
([ADR 0030](adr/0030-pre-trip-checklists.md)); checklist links must be HTTP or HTTPS and open
with `rel="noopener noreferrer"`. The organization never reads members' trips. Invitation tokens are 24 random bytes, shown once and stored only as
a SHA-256 hash; each works once, for seven days, and is revoked by the admin or by use.

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
- **Headers** (helmet): CSP allowing only same-origin scripts and styles (no inline), no framing
  except the read-only embeddable map ([ADR 0020](adr/0020-embeddable-map.md)),
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
  sitemap, so search engines do not list them, unless the owner opts in
  ([ADR 0023](adr/0023-shared-map-previews-and-indexing.md)); their link previews and preview
  pictures show only what the public map shows, never the home country. Whether a stay is still going on is never shared either, as it would tell
  where the traveler is now, and neither are the home country ([ADR 0014](adr/0014-home-lived-and-transit.md)),
  ledger settings or the date history. Whether a shared place was lived in or a layover is shown,
  like its status. Journey lines, which make the order of trips obvious, are drawn for visitors
  only when the owner turns them on ([ADR 0016](adr/0016-timeline-journeys-and-palettes.md)).
- Following a map shows only what its public page shows, and its owner is never told or shown
  who follows; a trip is visible only to its owner and the accounts it is shared with, and only
  editors change it ([ADR 0028](adr/0028-friends-and-shared-trips.md)).
- A guest map is kept only in the browser's storage and never sent, until the guest signs up and
  it moves into the account; anyone using the same browser profile can see it
  ([ADR 0026](adr/0026-guest-mode.md)).
- Photos, location history and calendar files chosen for an import are read in the browser and
  never uploaded; only the nearest town (or country) and the visit dates are sent, after the traveler
  reviews them ([ADR 0025](adr/0025-imports-from-photos-and-location-history.md)).
- "I'm here" reads the browser's location once, only when the traveler presses it and the
  browser allows it; the town is found in the bundled map data and only that town, at the map
  data's coordinates, is sent once the traveler confirms. The position is never sent or kept.
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
- The installable app keeps the traveler's last loaded places, trips and ledger in the
  browser's Cache Storage for offline use, and deletes them when the session ends: on signing
  in, out or up, deleting the account, or an expired session. Public maps are never stored
  ([ADR 0021](adr/0021-installable-offline-app.md)).
- An employer's report holds, per member, business days per country and rule statuses only:
  it reads only the visits marked as business trips for that organization and never returns
  place names, cities, dates or notes. Every report writes an audit entry per member shown,
  which the member reads in the app and in their data download, and is sent with
  `Cache-Control: no-store`. The report's CSV defuses formula cells like the evidence CSV.
- Travelers can download everything their account holds as one archive (`GET /api/export`,
  only ever the caller's own data, never the password hash) and delete their account, which
  removes all their data at once ([data model](data-model.md#privacy)).

## Runtime And Supply Chain

- The image runs Node.js only, as user 10001, with a read-only root filesystem, all Linux
  capabilities dropped and no service-account token; npm is removed from the runtime image and
  Debian packages are upgraded at build time.
- Translations ([ADR 0031](adr/0031-localization.md)) are static files of the release and are
  always inserted as text, never as markup; a sentence with elements in it keeps the page's own
  elements and only moves them.
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
