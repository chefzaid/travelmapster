# ADR 0021: An Installable App That Works Offline

- Status: Accepted
- Date: 2026-10-26

## Context

Travelers open the map where the network is poor: on planes, abroad without data, in remote
places. The map data is bundled and versioned ([ADR 0005](0005-bundled-map-data.md)), and the
frontend has no build step ([ADR 0002](0002-single-service-build-free-frontend.md)), so a small
service worker can keep the app usable offline without new tooling. An installable app on the
home screen is also the first step toward store apps on the roadmap.

## Decision

- **Installable.** `public/manifest.webmanifest` names the app and points to icons rendered
  from the logo (`scripts/build-icons.js`), standalone display, the sky theme colour.
- **Service worker.** `public/sw.js`, served unversioned and revalidated on every load:
  - fingerprinted assets (`/a/<fingerprint>/`: scripts, styles, fonts, map data and the town
    tiles already seen) come from its cache when there; a new release's files replace the old;
  - the app page (`/`) is fetched from the network, with its last copy for offline use; shared
    maps, the calculator and other pages always need the network;
  - the traveler's own reads (`/api/auth/me`, places, trips, ledger settings and the date
    history) are fetched from the network, keeping the last good answer for offline use.
- **Writes need the network.** Nothing is queued: a change made offline fails with a message
  saying it was not saved.
- **Nothing outlives the session.** Signing in, signing out, signing up or deleting the account,
  and any signed-out answer from `/api/auth/me` (an expired session), delete the copy of the
  account's data. Public maps are never stored.

## Consequences

- The last loaded places, visits, trips and ledger stay readable offline in the browser's
  Cache Storage of that device until the session ends; the security guide states it.
- Browser tests block the service worker, except the offline journey, so stubs and cold-start
  performance measurements stay deterministic.
- Offline edits, background sync and push notifications are not supported; they would need a
  queue and conflict rules of their own.
