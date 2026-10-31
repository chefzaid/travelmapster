# Roadmap

Planned work only; shipped behavior is listed in [features](docs/features.md). Keep the
[product principles](docs/features.md#product-principles) when adding features, and record
material design changes as an [ADR](docs/architecture.md#adr-process).

- [ ] Google and Facebook login, linked to existing accounts ([ADR 0003](docs/adr/0003-sessions-and-csrf.md)) *(waiting: see Needs Input › Social login providers)*
- [ ] Travel albums: give each pinned place a description and a photo album instead of a single photo link *(waiting: see Needs Input › Photo storage)*

## Bugs to fix

Bugs, failing checks, security findings and code smells found while working on another task. Each entry names the file or area, what is wrong, and how to reproduce it.

- [ ] Container image findings. The 2026-10-04 platform Trivy scan found 4 critical Debian bookworm findings in image `1.8.1` (Perl, zlib minizip). The runtime base is still `node:22.22.2-bookworm-slim` (`Dockerfile`, `NODE_IMAGE`), so `1.10.0` probably still carries them: rescan, and clear them with a base that drops those packages (for example an Alpine or distroless Node image) or record why they are not exploitable here. The database setup Job (`infra/k8s/database-setup-job.yaml`) renders the same PostgreSQL image as the other applications: `postgres:18.6-bookworm@sha256:b939b3851e2c…` is an amd64-only build from 2026-08-13; the tag now points to `sha256:bbf83594798e…` (rebuilt 2026-10-21) and the platform runs `sha256:3725f4e2499e…` (2026-09-19). The 2026-10-04 platform Trivy scan found critical Debian bookworm findings in this image (Perl, zlib minizip) with no Debian fix; the platform accepted them for its own PostgreSQL until 2026-11-04 ([swirl-cloud security](https://github.com/chefzaid/swirl-cloud/blob/main/docs/security.md#vulnerability-triage)), not for this repository. Recheck on the platform's Grafana **Trivy Security Reports** dashboard or with `trivy image --severity CRITICAL <image>`, then move to the current digest or a variant without the affected packages, or record an exception here. *(found by: Infra Agent, swirl-cloud TODO §21)* *(waiting: see Needs Input › Container image base)*
- [x] Untranslated confirmation when recording a trip as visits: `completeTrip` in `public/js/trip-visits.js` builds its message from English template literals ("{place}: a visit from {date} to {date}", "and wishes move from your wishlist to the places you have been", "You can edit visits on the place's card."), so it stays English in every language. Reproduce: choose Français in Settings, open a past trip and press ✅ Record as a visit. Fix: translate each part with `t()`/`tn()` and join the visits with `joinList()`. *(found by: Coding Agent)* Fixed: each part is translated and the visits are listed with `formatList()`; the "Trip: …" note saved on each visit is translated too.
- [x] Two-step sign-in test failing at a 30-second boundary: `test/integration/security.test.js` replays the code that turned two-step on by computing it again from the clock, so when the TOTP step turns between the two calls the "replayed" code is a new, valid one and sign-in succeeds (200, not 400); the next test then fails on the secret left behind. Seen in CI on 2026-10-31. Reproduce: run the test across a step boundary. Fixed: the test keeps the enabling code and replays that. *(found by: Coding Agent)*
- [x] Landing page weight creeping back to the budget: 988 KB of 1,000 KB on 2026-10-31 after a day of new features, all imported statically from `app.js` and so loaded on the landing page. Reproduce: `npx playwright test test/e2e/performance.spec.js` and read the logged figures. Fixed: the Trips and Ledger tabs load when first opened, and the trip planner, the rule dialog and sign-in security load on first use through `lazy.js`; docs/development.md says how to keep it so. *(found by: Coding Agent)*
- [x] Landing page at the edge of its performance budget: `test/e2e/performance.spec.js` measures 988–990 KB of the 1,000 KB page weight and a Largest Contentful Paint of about 3.8 s of the 4 s budget on the mid-range phone profile (it was about 2.7 s when the budget was set), so it fails under the load of the full browser run (seen on 2026-10-31, passing alone). Reproduce: `npx playwright test test/e2e/performance.spec.js` and read the logged figures. Fix: find what grew since the budget was set (the translations' loading before the first paint, more modules on the first load) and win the margin back. *(found by: Coding Agent)* Fixed: the presentation was hidden until all of the app's ~100 modules had loaded, and translating the page rewrote its text even in English, painting it again; `start.js` now shows it first (a press on its buttons waits for the app), unchanged text is left alone, and sign-in security, the importers' readers and the archive writers load on first use: 968 KB and 1.3–1.5 s.
- [x] Lists joined with an English comma: 17 places in `public/js` (for example `transitNote` in `passport.js`, "Transit only, not counted: {names}.") join names with `', '`, so Arabic shows a Latin comma instead of `،` and no language gets its own "and". Reproduce: choose العربية in Settings, mark two layovers, open the passport. Fix: use `formatList()` from `i18n.js` (`Intl.ListFormat`), as the passport's streaks do. *(found by: Coding Agent)* Fixed: lists that read as a sentence use `formatList()` ("Mar and Sep", "Lisbon and Porto"), plain enumerations and field values use `joinList()` with each language's comma, and docs/development.md says so.
- [x] Untranslated "Capital" on a capital's card: `public/js/cards.js` wrote ` · ★ Capital` after the country name as a plain string, so it stayed English in every language. Reproduce: choose Français in Settings and click Paris; the card reads "France · ★ Capital". Fixed: the label is translated. *(found by: Coding Agent)*
- [x] The side panel covers half of the map on wide screens and cannot be put away: `#panel` (`public/js/panel.js`, `public/css/layout.css`) has a collapse handle only as a bottom sheet on phones, so on a laptop the countries under the panel cannot be seen or clicked, even zoomed out. Reproduce: open the app at 1280 px wide; the panel always covers the left of the map. Fix: a button that folds the panel to a narrow strip and opens it again, remembered in this browser, with the map's padding following it. *(found by: owner)* Fixed: a tab on the panel's edge folds it away and back ("Show panel" while folded), remembered in this browser; choosing a tab, the sign-in form or the skip link opens it again, cards and fly targets use the freed space, and phones keep the bottom sheet. The "Days" legend button no longer looks struck through while off.
- [x] Wrong continent for island countries: `scripts/build-map-data.js` maps Natural Earth's "Seven seas (open ocean)" to Oceania, so Mauritius, Seychelles and Saint Helena (Africa) and the Maldives (Asia) count toward Oceania in the passport's continents (and South Georgia, the British Indian Ocean Territory, the French Southern Lands and Heard Island, which have no inhabited continent). Reproduce: mark Mauritius "Been there"; the passport shows Oceania. Fixed: the build gives them the continent of their UN M49 region (Africa, Asia, South America; Heard Island stays in Oceania); travelers who have been to them see their continent counts move. *(found by: Coding Agent)*
- [ ] No towns in the overseas territories split from France, Norway and the Netherlands (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, Svalbard, Caribbean Netherlands): GeoNames files them under their own country codes, which matched no shape before ADR 0024, so `public/data/cities*` has none. Reproduce: zoom into Réunion; no town names. Fix: run the full `node scripts/build-map-data.js <folder>` with GeoNames `cities500.txt` (see docs/development.md) and commit the data. *(found by: Coding Agent)* *(blocked: download.geonames.org is not reachable from the coding agent's environment; run the rebuild locally)*
- [x] Console errors while the map loads: hovering or clicking the map before its style had loaded queried the `cities` layer before it existed ("The layer 'cities' does not exist in the map's style"), seen in browser tests under load. `public/js/map.js` now queries only the layers that exist. *(found by: Coding Agent)*
- [x] Intermittent browser test failures, from showing the landing page before the map loads: a sign-up made before the map was ready could be undone by the page's first, signed-out look at the session, and tests used the map before it existed. The page now lets a session started meanwhile win, marks `#app[data-map="ready"]`, and the journeys wait for it; three full runs in a row pass. *(found by: Coding Agent)*
- [x] Slow first paint on phones: the landing page's Largest Contentful Paint on a mid-range phone was about 6.5 s; the landing panel now shows while MapLibre and the map data load (about 2.7 s), and the budget is 4 s. *(found by: Coding Agent)*
- [x] Files over the 500-line limit: `public/js/app.js` (527 lines, grown by guest mode and friends), `public/js/days.js` (656), `test/days.test.js` (519) and `test/frontend.test.js` (521). Reproduce: `wc -l` on them. Fixed: tabs and place saving moved to `tabs.js` and `place-store.js`, the evidence and rule checks to `ledger-evidence.js` and `ledger-rules.js`, and their tests to `ledger-rules.test.js` and `io.test.js`. *(found by: Coding Agent)*
- [x] Untranslated labels passed to helper functions: `public/js/ledger-report.js` builds the evidence report's date fields with `input('from', 'From', 'date')` and `input('to', 'To', 'date')`, so "From" and "To" stay English in every language (`scripts/i18n.js strings` only flags literals of two words or more). Reproduce: choose Français in Settings, open the Ledger tab; the evidence report's dates are labelled "From" and "To". Fix: wrap them in `t()`, and look for other one-word labels handed to helpers the same way. Fixed: those and 20 more (the passport cards, the map's atlas lines, population figures, dialog button defaults and others) are translated, an unused label table is gone, and `scripts/i18n.js strings` now also flags one-word labels handed to functions. *(found by: Coding Agent)*

## Needs Input

Parts of tasks that cannot advance without the owner's decision or information. Only the part needing input is set aside here; the rest of the task keeps moving. Answer under the item, and the next agent run applies the answer and removes the entry.

- [ ] **Container image base.** Clearing the findings needs an image build and a Trivy scan, which the coding agent's environment cannot run (no Docker daemon, no Trivy), and a choice the platform shares. Which way? (a) Node runtime on Alpine (`node:22-alpine`): no Perl, current zlib; `bcrypt` ships no musl prebuild, so the `deps` stage needs `python3 make g++` to compile it, and the `LIBC=glibc` workaround goes. (b) Distroless (`gcr.io/distroless/nodejs22-debian12`): still Debian 12, no shell, so the `HEALTHCHECK` and `CMD` change; whether zlib1g is still present needs a scan. (c) Keep bookworm-slim and record an exception, if the findings are not reachable here (the app runs no Perl and Node bundles its own zlib). For the database setup Job: switch to `postgres:18-alpine` (it only runs `psql`), or keep the image the other applications use? Please paste the current `trivy image --severity CRITICAL` result for `1.10.0` if you have it. *(task: Bugs to fix › Container image findings; asked by: Coding Agent)*
  - Answer:
- [ ] **Social login providers.** Google and Facebook sign-in needs an OAuth client for each (client ID and secret, stored as platform secrets) and the production redirect URL. Do you want both, or Google first? Should an existing account be linked only after the traveler signs in with their password (safest), or also when the provider's verified email matches (needs the email task first)? *(task: Google and Facebook login; asked by: Coding Agent)*
  - Answer:
- [ ] **Transactional email provider.** Email verification, password reset, ledger email alerts and the "On this day" digest all need a sender. Which provider (for example Postmark, Amazon SES, Brevo, or the platform's own SMTP relay), which sending domain, and SMTP or the provider's HTTP API? An ADR records the choice as a new external dependency. *(task: Accounts and trust › Email address; Day ledger › Email alerts; Product features › "On this day" email digest; Technical foundation › Background jobs; asked by: Coding Agent)*
  - Answer:
- [ ] **Photo storage.** Albums, travel books and photo uploads need S3-compatible object storage. Which service (the platform's MinIO, Cloudflare R2, Scaleway, AWS S3…), which bucket and region, and what quota per plan (free and Pro)? The app would resize on the server and strip location metadata from anything shown publicly. *(task: Travel albums; Commercial foundation › Photo storage; Keepsakes › travel book; asked by: Coding Agent)*
  - Answer:
- [ ] **Paid plans and payments.** Plans, entitlements, plan pricing on the landing page, referrals and the pricing waitlist all need the plan list and prices, and a payment provider with EU VAT handling (for example Stripe with Stripe Tax, Paddle or Lemon Squeezy as merchant of record). Which provider, which prices (monthly and annual), and which features are Pro-only at launch? ADR 0017 already rules that nothing free today becomes paid. *(task: Commercial foundation › Plans and entitlements; Market and growth › plan pricing, referrals, pricing validation; asked by: Coding Agent)*
  - Answer:
- [ ] **Print-on-demand partner.** Ordering printed posters needs a print partner with an API (for example Gelato or Prodigi) and an account. Which one, and which sizes and paper? The poster export itself (vector file in standard sizes) does not wait on this. *(task: Keepsakes › Map poster export (ordering part); asked by: Coding Agent)*
  - Answer:
- [ ] **Travel-club country lists.** Counting by the Travelers' Century Club list needs the club's permission or a licence, and map data that draws the parts it counts on their own. Do you have, or want to request, that permission? *(task: Market and growth › Travel-club country lists; asked by: Coding Agent)*
  - Answer:
- [ ] **Legal texts.** Terms of service and a privacy policy need the legal entity (name, address, registration), the governing law, a contact for data requests and whether a DPO is appointed. Will you supply the texts or the facts for a draft that a lawyer reviews? The GDPR access request flow can follow once the full account export exists. *(task: Accounts and trust › Terms of service, privacy policy and GDPR; asked by: Coding Agent)*
  - Answer:
- [ ] **App store accounts.** Mobile apps need Apple Developer and Google Play accounts and the store listing details. Should this start now that the ledger has shipped, or after the PWA? *(task: Technical foundation › Mobile apps; asked by: Coding Agent)*
  - Answer:
- [ ] **Partnerships.** Partnerships with tax advisers, relocation and employer-of-record firms, and print partners are business work outside the code. Which partners, if any, should the app integrate with or mention? *(task: Market and growth › Partnerships for Teams; asked by: Coding Agent)*
  - Answer:
- [ ] **Recovery targets.** Stated recovery for paying users needs the RPO and RTO you are willing to promise and the platform backup schedule (swirl-cloud). Are 24 hours RPO and 4 hours RTO right? Where should the restore drill run (a scheduled platform job or a manual runbook step)? *(task: Technical foundation › Recovery for paying users; asked by: Coding Agent)*
  - Answer:
- [ ] **Alert rules.** Where should the burn-rate alerts on the service level objectives live: a `PrometheusRule` in `infra/k8s/` (does the platform's Prometheus select rules from application namespaces, and with which labels?) or in swirl-cloud's alerting configuration? Where do alerts go (channel or pager)? Are the proposed objectives right: 99.5% of API requests without a 5xx, and 95% within 500 ms, over 30 days? *(task: Technical foundation › Alerts on the service level objectives; asked by: Coding Agent)*
  - Answer:
- [ ] **World Heritage sites.** Sites are not towns, so the collection needs a way to count them. Which one? (a) Tick sites off a list per country in the passport, stored on the account (exact, a little more to do for the traveler); (b) count a site when a saved town lies within a few kilometers (automatic, but wrong for rural sites and big cities); (c) both, with (b) as a suggestion to confirm. And which data: Wikidata (CC0, includes coordinates) or UNESCO's own list (CC BY-SA 3.0 IGO, needs credit)? *(task: Product features › UNESCO World Heritage sites; asked by: Coding Agent)*
  - Answer:
- [ ] **Organization single sign-on.** Teams single sign-on: OIDC only, or SAML as well? Is a hosted broker (for example WorkOS) acceptable, or must it stay in the app? A data processing agreement needs the legal entity from Legal texts. *(task: Teams tier › Organization single sign-on; asked by: Coding Agent)*
  - Answer:
- [ ] **Public holidays and climate data.** Showing public holidays and typical weather at a destination during a trip needs data the app does not bundle. Holidays: Nager.Date's data (MIT, about 120 countries; fetched by the server and cached, or bundled per release)? Climate normals: a bundled monthly table per country from an open source such as NASA POWER (public domain), coarse but private, or no weather at all? *(task: New ideas › Trips › Holidays and weather; asked by: Coding Agent)*
  - Answer:

## Product direction (added 2026-10-04)

TravelMapster is a playful travel atlas; many apps already color visited countries. The niche to own is **the travel record you can rely on and keep**: the cartoon atlas stays, but every visit carries dates, so the app also counts days per country — Schengen 90/180, visa stay limits, tax-residency thresholds — for digital nomads, expats and frequent business travellers. It also turns travels into keepsakes: printed posters and travel books. A Teams tier lets companies track employees' business-travel days for tax and social-security obligations without seeing personal trips.

Differentiators:

1. A fun atlas and a dependable day ledger in one place.
2. History filled automatically from location exports and photos, processed privately.
3. Physical keepsakes from the same map.
4. No third-party map services (existing principle), which makes the privacy promise credible.

### Principles

- [x] **ADR — product principles:** extend the [product principles](docs/features.md#product-principles) to cover the day ledger, keepsakes and paid tiers while keeping the map itself simple (country borders and towns only, no tiles).

### Day ledger (builds on the Ledger tab, [ADR 0010](docs/adr/0010-day-ledger.md))

- [x] A short "a guide, not legal or tax advice" note on the Ledger tab and the evidence report, like the Schengen calculator's ([ADR 0017](docs/adr/0017-product-principles.md)).
- [ ] Email alerts before thresholds and stay limits are reached; alerts are in-app only until email exists (see [Accounts and trust](#accounts-and-trust-added-2026-10-23)), and scheduled checks need the background jobs below. *(waiting: see Needs Input › Transactional email provider)*
- [x] Overseas territories drawn as part of a country on the map (French Guiana, Réunion, Svalbard, Caribbean Netherlands) counted on their own, so they stop counting as Schengen days.
- [x] Automatic import from location-history exports and photo metadata (dates and GPS), processed in the browser and reduced to country and city before upload; the user reviews every visit before it is saved.

### Keepsakes and sharing

- [x] Map poster export: high-resolution vector output in standard sizes and styles with a title.
- [ ] Print-on-demand ordering of posters. *(waiting: see Needs Input › Print-on-demand partner)*
- [ ] Yearly travel recap and a printable travel book from places, notes and photos (builds on travel albums). *(waiting: see Needs Input › Photo storage)*
- [x] Shareable image cards (passport stamps, country count, yearly recap) without exposing private notes.
- [x] Friends: follow public maps, compare countries visited, and plan an itinerary together with edit or view roles.
- [x] Installable offline app (PWA) using the bundled map data.

### Teams tier

- [x] **ADR — Teams:** ([ADR 0022](docs/adr/0022-teams.md)) organization accounts where employees record business trips. Personal trips are never visible to the employer, which sees only business-travel day counts per country.
- [x] Threshold rules per destination for tax and social security, configured by the organization, with alerts to the traveller and the mobility or HR team and reports for their advisers. ([ADR 0029](docs/adr/0029-organizations-and-business-days.md): organizations with roles, invitation links, business trips, employer rules in the Ledger tab, the report with CSV and the audit log.)
- [x] Pre-trip checklist per destination configured by the organization (for example A1 certificate and posted-worker declaration reminders within the EU). ([ADR 0030](docs/adr/0030-pre-trip-checklists.md): business trips, tasks per country with due dates in the trip editor and the trips list; email reminders wait for a sender.)
- [ ] Organization single sign-on and a data processing agreement; roles, the audit log, data export and deletion came with [ADR 0029](docs/adr/0029-organizations-and-business-days.md). *(waiting: see Needs Input › Organization single sign-on)*

### Commercial foundation

- [ ] Plans and entitlements enforced server-side: free atlas; Pro (day ledger, imports, evidence reports, albums, poster exports); Teams per traveller. Payments with EU VAT handling for digital services. *(waiting: see Needs Input › Paid plans and payments)*
- [ ] Photo storage for albums: the app stores no files today, so albums and travel books need S3-compatible object storage with per-plan quotas, server-side resizing, and location metadata stripped from anything shown publicly. *(waiting: see Needs Input › Photo storage)*
- [x] Privacy statement for the ledger: precise coordinates are never stored beyond city level unless the user chooses, and evidence reports are generated only on request.

## Market and growth (added 2026-10-23)

- [ ] Refresh the [competitive review](docs/competitive-review.md) by 2027-04-26 (every six months). *(blocked: not due before 2027-04-01)*

The field splits into scratch-map atlases (Been, Visited, Skratch), travel journals (Polarsteps, Journi), trip planners (Wanderlog, TripIt) and day-tracking tools for tax residency (Monaeo and similar). Atlases are free and crowded, journals depend on phone tracking, and day trackers are dry, costly and built for advisers. TravelMapster's opening is the overlap: the atlas wins the user for free, the ledger earns the subscription, and keepsakes pay one-off. Growth should come from things people share or search for, not from ads or third-party trackers.

- [x] Competitive review in `docs/`: features, pricing and privacy stance of the main atlas, journal, planner and day-tracking apps, refreshed every six months, with the gaps TravelMapster targets.
- [x] Presentation website: a full page that presents what TravelMapster does and each of its features (atlas, places and visits, journeys, trips, passport, day ledger, Schengen calculator, sharing), shown to visitors before the app instead of the sign-up panel over the demo map. Update [ADR 0011](docs/adr/0011-public-pages.md), where `/` stays the app.
- [ ] Plan pricing on the landing page once paid plans exist: it shows the free plan and keepsakes as coming soon today, without prices ([ADR 0011](docs/adr/0011-public-pages.md)). *(waiting: see Needs Input › Paid plans and payments)*
- [x] Public maps worth sharing: opt-in indexing (shared maps are sent with `noindex` and left out of the sitemap until then), an Open Graph preview image of the user's map, and a "make your own map" call to action.
- [ ] Travel-club country lists (such as the Travelers' Century Club's) as a choice for counting, beside the UN and full-map lists ([ADR 0015](docs/adr/0015-country-lists.md)): needs the club's permission or a licence, and map data that draws the parts those lists count on their own (states, islands and regions such as Alaska or the Canary Islands). *(waiting: see Needs Input › Travel-club country lists)*
- [ ] Referrals: an invite link that gives both sides a free Pro month or a poster discount. *(waiting: see Needs Input › Paid plans and payments)*
- [x] Localization: extract UI strings and ship French, Spanish, German and Arabic (right-to-left layout), with country names from Natural Earth's localized fields. ([ADR 0031](docs/adr/0031-localization.md): `t()`/`tn()` and marked markup, one catalog per language checked by a test, the language from the browser or Settings, the layout mirrored for Arabic.)
- [ ] Native-speaker review of the French, Spanish, German and Arabic catalogs (`public/locales/*.json`), drafted by the coding agent, before marketing in each language. *(waiting: reviewers for each language)*
- [x] Privacy-respecting product metrics: server-side aggregate counters for the funnel (sign-up, first place, ten places, first ledger use, paid) and retention, with no third-party analytics.
- [ ] Partnerships for Teams: tax advisers, relocation and employer-of-record firms that can resell or recommend the tier; print partners for keepsakes in the EU and North America. *(waiting: see Needs Input › Partnerships)*
- [ ] Pricing validation before launch: a waitlist and survey for Pro and Teams, annual billing first, and an early-supporter price for the first users. *(waiting: see Needs Input › Paid plans and payments)*

## Accounts and trust (added 2026-10-23)

- [x] Guest mode: visitors without an account can pin places and use every feature, with everything saved in the browser's local storage; signing in stays optional. Today a signed-out visitor's changes to the demo map are never saved ([ADR 0011](docs/adr/0011-public-pages.md)), so this needs an ADR.
- [ ] Email address with verification and password reset; today a forgotten password locks the user out for good. Needs a transactional email provider ([ADR](docs/architecture.md#adr-process): new external dependency). *(waiting: see Needs Input › Transactional email provider)*
- [x] Passkeys (WebAuthn) and optional TOTP two-factor sign-in, required for Teams administrators (required of organization managers and admins since [ADR 0029](docs/adr/0029-organizations-and-business-days.md)).
- [x] Full account export as one archive (places, visits, trips, albums, ledger) plus GeoJSON and KML export of places; the "record you can keep" promise depends on it.
- [ ] Terms of service, privacy policy and a GDPR access request flow, published before the first paid plan. *(waiting: see Needs Input › Legal texts)*
- [x] Sign-up abuse protection without third-party captchas (honeypot field and per-IP limits on registration).

## Technical foundation (added 2026-10-23)

- [x] Contract step of the places and visits split, first release ([ADR 0009](docs/adr/0009-places-and-visits.md)): the app no longer reads or writes `markers.travel_date`; a `travelDate` from an old tab or a file becomes a visit in the app.
- [ ] Contract step, second release: a migration that drops the `markers.travel_date` mirror and its three sync triggers and functions (`test/integration/contract.test.js` already runs the app without them). *(blocked: ships only in a release after 1.10.0, once no running release writes the column)*
- [ ] Background jobs in PostgreSQL (`FOR UPDATE SKIP LOCKED` queue) for imports, poster rendering, emails and scheduled threshold alerts, keeping the single service ([ADR 0002](docs/adr/0002-single-service-build-free-frontend.md)). Imports and posters now run in the browser ([ADR 0025](docs/adr/0025-imports-from-photos-and-location-history.md), the poster export), so emails and scheduled alerts are what the queue is for, and both need a sender first. *(waiting: see Needs Input › Transactional email provider)*
- [x] OpenAPI description of the JSON API and a versioning rule, needed before mobile apps or Teams integrations.
- [x] Type checking of server and browser modules with JSDoc and `tsc --noEmit` in CI, without adding a build step.
- [x] Performance budget in CI: page weight, map data payload and Web Vitals on a mid-range phone profile; precompressed (Brotli) map data.
- [ ] Recovery for paying users: stated RPO and RTO, a scheduled restore drill from the platform backup, and a logical dump before risky migrations. *(waiting: see Needs Input › Recovery targets)*
- [x] Service level objectives for availability and API latency, with their queries in the [runbook](docs/operations.md#service-level-objectives), plus business metrics (places saved by source, account exports; evidence reports stay on the device and are not counted).
- [ ] Alerts on the service level objectives (burn-rate rules). *(waiting: see Needs Input › Alert rules)*
- [ ] Mobile apps (Capacitor wrapper of the PWA) only once the ledger ships, for store discovery and optional background location that records the current country on the device, never raw coordinates on the server. *(waiting: see Needs Input › App store accounts)*

## Product features (added 2026-10-23)

Everyday features that make the free atlas worth opening again; the paid work above builds on them.

### Places

- [x] Import from other travel map apps (Been, Visited, Polarsteps exports) with a preview before saving: Polarsteps data exports, and pasted country lists from Been, Visited or any atlas, whose exports have no documented file format.

### Trips

- [x] Plan a trip from a wishlist place, and let planned trip dates become the ledger's planned stays.
- [x] Itinerary map: pins and a route per day, and drag-and-drop to reorder slots and days.
- [x] Multi-destination trips spanning several countries and cities, each with its own dates.
- [x] Completing a trip turns its destinations into visits with the trip's dates, after the user confirms.
- [x] Packing list and budget per trip, with expenses in any currency and a total in the home currency.
- [x] Export an itinerary to a calendar (`.ics`) and as a printable PDF; duplicate a trip as a template.

### Passport and goals

- [x] Richer passport stats: days abroad per year, longest trip, approximate distance travelled and a countries-per-year timeline.
- [x] Yearly goals ("three new countries in 2027") with progress on the passport and a celebration when reached.
- [x] Collections to complete: every capital and every EU country, with their own badges.
- [ ] UNESCO World Heritage sites as a collection, from open data. *(waiting: see Needs Input › World Heritage sites)*
- [x] "On this day" memories of past visits, shown in the app.
- [ ] "On this day" memories in an optional email digest, once email exists (see [Accounts and trust](#accounts-and-trust-added-2026-10-23)). *(waiting: see Needs Input › Transactional email provider)*

### Sharing

- [x] Embeddable public map for blogs and personal sites, read-only and without notes.

## New ideas (added 2026-10-26)

Ideas that follow the product direction: a travel record people rely on for visas and taxes, an atlas worth opening again, and Teams that plan ahead. None needs a new external service unless it says so.

### Day ledger

- [x] Travel history for visa forms: every trip abroad in the last 5 or 10 years (country, entry and exit dates, purpose), as UK, US, Canadian and Australian visa applications ask, printable and as CSV, from the ledger's stays.
- [x] "Where was I on…?": pick any date or range and see the country and town for each day, with the visit behind it; also a quick answer on the Ledger tab.
- [x] Days that do not count: periods under a residence permit or long-stay visa of a country, excluded from that country's stay rules (the Schengen calculator page already says such days do not count, but the ledger counts them). Done: 🪪 Days that do not count in the Ledger tab, saved with the ledger settings (migration 021); stay rules and plans leave those days out, thresholds keep them.
- [ ] Travel documents: passports, visas and residence permits with their validity dates, warnings before they expire, and a check of planned trips against the common "valid six months after your stay" rule; numbers are never stored, only names and dates.
- [x] Rule templates: ready-made stay rules and thresholds people commonly need (UK Statutory Residence Test day counts, Schengen-style limits of other countries, 183-day rules), each with its source and the "a guide, not tax advice" note. Done: 📚 From a template beside each add button in the Ledger tab: Türkiye 90/180, the UK residence test's 16, 46 and 183 days, Australia, India, Canada, New Zealand and the treaty 183 days in any 12 months, each with its source.
- [x] US Substantial Presence Test: a weighted threshold over three years (days this year, a third of last year's, a sixth of the year before), a rule kind the ledger cannot express today. Done: built in, among the tax-residency thresholds once the ledger has US days in the last three years.
- [x] Ledger health: point out overlapping visits in countries too far apart for the same day, visits with no end date, and stays abroad with no way back, so the record holds up when it matters. Done: 🩺 Ledger health in the Ledger tab; "no way back" is a stay still marked "still there" after a later visit elsewhere, since days with no visit are not counted anywhere.

### Atlas and places

- [x] Days on the map: an option to color countries by days spent (from the ledger) instead of by status, as a heat map. Done: 🌡️ Days in the legend colors countries in four steps (under a month, 30, 90 and 183 days), with the countries in each step, the days on the country card, and the timeline's year when it is open.
- [ ] Regions: states, provinces and regions (Natural Earth admin-1, public domain) as an optional deeper level for the largest countries, counted like countries; mind the map data budget.
- [ ] Flight log: flights by airport codes (OurAirports, public domain) drawn as arcs, with distance per year and a rough CO₂ estimate on the passport.
- [x] Merge duplicate places (two pins for the same town, often after imports), keeping every visit. Done: 🔁 Possible duplicates in the Places tab and `POST /api/markers/{id}/merge`, which moves the visits with their ids and history in one transaction.

### Trips

- [ ] Shared trip expenses: on a trip planned together, who paid what and who owes whom, in the trip's currency.
- [ ] Reservations: flights, stays and bookings with times, addresses and confirmation codes in a trip's days, included in the calendar export.
- [ ] Calendar subscription: a private, revocable feed URL of trips and planned stays for Google, Apple or Outlook calendars.
- [x] Import trips and flights from a calendar file (`.ics`), read in the browser and reviewed like other imports. Done: 📅 Calendar among the Places tab's imports; travel-like events only, the home country left out.
- [ ] Public holidays and typical weather at the destination during a trip. *(waiting: see Needs Input › Public holidays and climate data)*

### Teams

- [ ] Forecast in the employer's report: planned business trips counted as planned days, so a rule shows when it would be reached before anyone travels.
- [ ] Personal and organization API tokens (read-only, revocable, listed in the audit log) for accountants' and HR systems' integrations, on the documented API.

### Accounts and trust

- [ ] Signed-in devices: the list of active sessions with their browser and last use, and signing out any of them.
- [ ] Account deletion with a 30-day grace period during which signing in restores everything; deleted for good after it.
- [ ] Security activity: sign-ins, new passkeys and two-step changes listed in Sign-in security, so a traveler notices an intruder.

### Accessibility

- [x] A list view of the map: every country and its status in a table that screen-reader and keyboard users can browse and mark, as an equal alternative to clicking the map. Done: "Countries as a list" from the second skip link and the Places tab, with a filter and a status per country.

## More ideas (added 2026-10-31)

Small, everyday things travelers ask for, built on data the app already has or a small bundled table. None needs a new external service, and none should grow beyond what its line says.

### Atlas

- [x] "I'm here" check-in: one tap reads the browser's location once, finds the country and town from the map data in the browser, and records today as a visit (or extends the ongoing one); the position itself is never sent or stored. Keeps the ledger right with no typing. Done: 📍 I'm here on the Explore tab, asking before it records; a second check-in the same day changes nothing.
- [x] Copy my flags: the visited countries as a line of flag emoji (🇫🇷🇯🇵🇲🇦…) with the count, to paste into a social bio or a message. Done: 📋 Copy my flags under the passport's stamps.
- [x] How much of the world: the share of the world's land area and population in the countries visited, beside the country count on the passport (areas from the map shapes, populations already bundled). Done: two passport tiles, over every country and territory on the map.
- [x] One border away: countries not yet visited that border ones already visited, as easy next trips in the Explore tab (neighbors worked out once when the map data is built). Done: worked out once in the browser from the shapes' shared border vertices instead, so the map data stays as it is.
- [x] Long time no see: countries and towns last visited five or more years ago, as a gentle "go back" list in the Explore tab, from the visit dates. Done: 👋 Long time no see on the Explore tab, countries with their towns and the year of the last visit.
- [x] Travel streak: consecutive years with a new country, and with any trip abroad, on the passport, with the current and the best streak. Done: 🔥 and 🧳 tiles under On the road (the abroad streak once a home country is set), and the best streaks with their years.

### Trips

- [x] Countdown to the next trip ("Lisbon in 12 days") in the Explore tab and on the passport, and as a share card. Done: the card shows the days to go and the countries' flags only, as the other share cards promise no places or dates.
- [ ] Travel companions: names of who came along on a visit or trip (names only, no accounts), and the map filtered to one of them ("everywhere I've been with Sam").
- [ ] Packing list templates: save a list as a named template (beach, city, business, ski) and start a new trip's list from one.
- [ ] Before you go: emergency number, driving side, plug types and the time difference on each destination of a trip, from a small table bundled from Wikidata (CC0).
- [ ] Family view of a trip: a private, revocable read-only link to a trip's days and stops (no notes, no bookings), so family knows where the traveler is this week without an account.

### Comfort

- [x] Theme in Settings: follow the system, light or dark, for people whose system theme does not suit the map. Done: "Light or dark" in Settings, kept in the browser and applied before the page shows.
- [x] Kilometers or miles in Settings for distances on the passport and trips, following the language at first. Done: "Distances in" in Settings, kept in the browser; trips show no distances today, so the passport's is the one that follows it.
- [x] Keyboard shortcuts: `?` lists them (`/` search, Escape and the timeline's keys today), with a few more: `T` timeline, `D` days on the map, `[` to fold the panel. Done: all in `shortcuts.js`, waiting while the traveler types or a dialog is open.
