# ADR 0011: Public Pages For Visitors Without An Account

- Status: Accepted
- Date: 2026-10-23

## Context

Signed-out visitors used to land on a sign-up form over an empty map, and nothing on the site
could be found through a search engine. Growth should come from things people search for or
share, not from ads or third-party trackers ([roadmap](../../TODO.md#market-and-growth-added-2026-10-23)).
Two pages serve that: a landing page that shows what the app does before asking for an account,
and a free Schengen 90/180 calculator, a common search. Both have to keep the build-free,
single-service frontend ([ADR 0002](0002-single-service-build-free-frontend.md)), the strict CSP
and the privacy promise of the day ledger ([ADR 0010](0010-day-ledger.md)).

## Decision

- **Static HTML pages.** Each public page is a real HTML file in `public/` with its own title,
  meta description, headings and text, served by Express at a clean path (`/` and
  `/schengen-calculator`) with the asset fingerprint rewritten like the app page. There is no
  server-side rendering: crawlers read the static content, and scripts only add the
  interactive parts.
- **Presentation.** Signed-out visitors at `/` first see a full presentation page over the app:
  every feature (atlas, places and visits, journeys, trips, passport, day ledger, Schengen
  calculator, sharing, data ownership) and the plans, with **Sign up free**, **Log in** and
  **Explore the demo map**. It is static HTML in `index.html`, so crawlers read it, and the app
  behind it stays inert. A browser that was signed in recently waits for the session check
  before showing it, so returning travelers never see it flash; shared maps and the `#sign-up`
  and `#log-in` links skip it, and the landing panel links back to it. *(Amended 2026-10-26.)*
- **Landing page.** `/` stays the app. Signed-in visitors land on their map as before, and a
  shared map (`/?u=<name>`) opens read-only as before. Signed out, the panel tells the atlas,
  ledger and keepsakes story, shows the plans (the free plan today, keepsakes marked as coming
  soon, no prices until paid plans exist) and holds the sign-up form, while the real map shows a
  sample traveler from `public/js/demo.js` with dates relative to today. Visitors can color in
  places on it; those changes stay in the page and are never sent to the API. Links to
  `/#sign-up` and `/#log-in` open the form in that mode.
- **Calculator.** `/schengen-calculator` counts typed-in stays with the same rules as the Ledger
  tab: `public/js/schengen.js` checks the stays and calls `days.js`, so the free tool and the
  ledger can never disagree. Dates stay in the tab: no API call, no cookie, no browser storage.
  The member list is written in the page and checked against `days.js` by a unit test.
- **Crawler plumbing.** `robots.txt` keeps crawlers out of `/api/` and points to `sitemap.xml`,
  which lists the public pages only. Absolute URLs use `PUBLIC_URL`, or the origin of the
  request when it is not set. Shared maps are served with `X-Robots-Tag: noindex` until their
  owners can opt in to indexing (they can since [ADR 0023](0023-shared-map-previews-and-indexing.md)).

## Consequences

- No new dependency, origin or CSP exception; both pages run under the same policy as the app.
- Each new public page is an HTML file, an entry in `src/assets.js` and `src/seo.js`, and a
  route; text that search engines should read must be in the HTML, not drawn by scripts.
- The demo map loads the full map data for every signed-out visitor, as the sign-up page did.
- The calculator cannot carry stays over to a new account, since it stores nothing; signing up
  starts an empty ledger.
