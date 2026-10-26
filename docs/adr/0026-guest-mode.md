# ADR 0026: Guest Mode, A Map Kept In The Browser

- Status: Accepted
- Date: 2026-10-26

## Context

Signed-out visitors could try the demo map, but nothing they did was kept
([ADR 0011](0011-public-pages.md)): to plan a trip or start a ledger they had to create an
account first. Many people want to try a tool for real before handing over even a username,
and the app already answers every feature that is not shared from a small set of API calls.

## Decision

- **The same API, in the browser.** `public/js/guest-api.js` implements the API client's
  methods for places, visits, bulk changes, imports, trips, the ledger's settings, the account
  settings and the account archive over `localStorage`, answering in the API's shapes. While a
  guest map is open, `useApi` in `api.js` points the shared `api` object at it, so every
  feature module works unchanged. Searching the bundled and indexed towns still asks the
  server, which needs no account; nothing else is sent.
- **What needs an account.** A guest map is never public: no share link, embed, link preview or
  journey lines for visitors. It has no password, no history of visit dates (the server keeps
  that history) and no world-wide geocoding (an authenticated, rate-limited route); those say
  so instead of failing.
- **Starting, leaving and coming back.** "Try it without an account" on the presentation and
  the landing panel opens the guest map; a note above the tabs says it is kept in this browser
  only. Leaving keeps it, and the browser opens it again on the next visit until the guest
  leaves. "Clear guest map" deletes it.
- **Moving into an account.** "Save to a free account" opens the sign-up form; once an account
  opens in a browser that holds a guest map, its places (with visits), trips, ledger rules and
  plans move in, and for a new account its settings too. An account that already has a map asks
  first; declining keeps the guest map in the browser. The move uses the import and the
  existing routes, so the server validates everything as usual.

## Consequences

- No server change: guests cost nothing until they sign up, and they never appear in the
  product metrics before then ([ADR 0018](0018-product-metrics.md)).
- A guest map lives and dies with the browser's storage: clearing site data, a private window
  or another device loses it, and anyone using the same browser profile can see it. The note
  says so, and the presentation keeps "Sign up free" first.
- Browser storage holds a few megabytes, far more than a travel map needs; a full storage is
  reported and the guest is invited to sign up.
- New API methods need a guest version, or must be listed among those that need an account.
