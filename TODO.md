# Roadmap

Planned work only; shipped behavior is listed in [features](docs/features.md). Keep the
[product principles](docs/features.md#product-principles) when adding features, and record
material design changes as an [ADR](docs/architecture.md#adr-process).

- [ ] Google and Facebook login, linked to existing accounts ([ADR 0003](docs/adr/0003-sessions-and-csrf.md))
- [ ] Travel albums: give each pinned place a description and a photo album instead of a single photo link

## Product direction (added 2026-10-04)

TravelMapster is a playful travel atlas; many apps already color visited countries. The niche to own is **the travel record you can rely on and keep**: the cartoon atlas stays, but every visit carries dates, so the app also counts days per country — Schengen 90/180, visa stay limits, tax-residency thresholds — for digital nomads, expats and frequent business travellers. It also turns travels into keepsakes: printed posters and travel books. A Teams tier lets companies track employees' business-travel days for tax and social-security obligations without seeing personal trips.

Differentiators:

1. A fun atlas and a dependable day ledger in one place.
2. History filled automatically from location exports and photos, processed privately.
3. Physical keepsakes from the same map.
4. No third-party map services (existing principle), which makes the privacy promise credible.

### Principles

- [ ] **ADR — product principles:** extend the [product principles](docs/features.md#product-principles) to cover the day ledger, keepsakes and paid tiers while keeping the map itself simple (country borders and towns only, no tiles).

### Day ledger (builds on the Ledger tab, [ADR 0010](docs/adr/0010-day-ledger.md))

- [ ] Email alerts before thresholds and stay limits are reached; alerts are in-app only until email exists (see [Accounts and trust](#accounts-and-trust-added-2026-10-23)), and scheduled checks need the background jobs below.
- [ ] Overseas territories drawn as part of a country on the map (French Guiana, Réunion, Svalbard, Caribbean Netherlands) counted on their own, so they stop counting as Schengen days.
- [ ] Automatic import from location-history exports and photo metadata (dates and GPS), processed in the browser and reduced to country and city before upload; the user reviews every visit before it is saved.

### Keepsakes and sharing

- [ ] Map poster export: high-resolution vector output in standard sizes and styles with a title, plus print-on-demand ordering.
- [ ] Yearly travel recap and a printable travel book from places, notes and photos (builds on travel albums).
- [ ] Shareable image cards (passport stamps, country count, yearly recap) without exposing private notes.
- [ ] Friends: follow public maps, compare countries visited, and plan an itinerary together with edit or view roles.
- [ ] Installable offline app (PWA) using the bundled map data.

### Teams tier

- [ ] **ADR — Teams:** organization accounts where employees record business trips. Personal trips are never visible to the employer, which sees only business-travel day counts per country.
- [ ] Threshold rules per destination for tax and social security, configured by the organization, with alerts to the traveller and the mobility or HR team and reports for their advisers.
- [ ] Pre-trip checklist per destination configured by the organization (for example A1 certificate and posted-worker declaration reminders within the EU).
- [ ] Organization single sign-on, roles, audit log, data export and deletion, and a data processing agreement.

### Commercial foundation

- [ ] Plans and entitlements enforced server-side: free atlas; Pro (day ledger, imports, evidence reports, albums, poster exports); Teams per traveller. Payments with EU VAT handling for digital services.
- [ ] Photo storage for albums: the app stores no files today, so albums and travel books need S3-compatible object storage with per-plan quotas, server-side resizing, and location metadata stripped from anything shown publicly.
- [ ] Privacy statement for the ledger: precise coordinates are never stored beyond city level unless the user chooses, and evidence reports are generated only on request.

## Market and growth (added 2026-10-23)

The field splits into scratch-map atlases (Been, Visited, Skratch), travel journals (Polarsteps, Journi), trip planners (Wanderlog, TripIt) and day-tracking tools for tax residency (Monaeo and similar). Atlases are free and crowded, journals depend on phone tracking, and day trackers are dry, costly and built for advisers. TravelMapster's opening is the overlap: the atlas wins the user for free, the ledger earns the subscription, and keepsakes pay one-off. Growth should come from things people share or search for, not from ads or third-party trackers.

- [ ] Competitive review in `docs/`: features, pricing and privacy stance of the main atlas, journal, planner and day-tracking apps, refreshed every six months, with the gaps TravelMapster targets.
- [ ] Plan pricing on the landing page once paid plans exist: it shows the free plan and keepsakes as coming soon today, without prices ([ADR 0011](docs/adr/0011-public-pages.md)).
- [ ] Public maps worth sharing: opt-in indexing (shared maps are sent with `noindex` and left out of the sitemap until then), an Open Graph preview image of the user's map, and a "make your own map" call to action.
- [ ] Choice of country list for counting (UN members, all 250 territories, travel-club lists such as TCC), with a documented rule for disputed and partially recognized territories.
- [ ] Referrals: an invite link that gives both sides a free Pro month or a poster discount.
- [ ] Localization: extract UI strings and ship French, Spanish, German and Arabic (right-to-left layout), with country names from Natural Earth's localized fields.
- [ ] Privacy-respecting product metrics: server-side aggregate counters for the funnel (sign-up, first place, ten places, first ledger use, paid) and retention, with no third-party analytics.
- [ ] Partnerships for Teams: tax advisers, relocation and employer-of-record firms that can resell or recommend the tier; print partners for keepsakes in the EU and North America.
- [ ] Pricing validation before launch: a waitlist and survey for Pro and Teams, annual billing first, and an early-supporter price for the first users.

## Accounts and trust (added 2026-10-23)

- [ ] Email address with verification and password reset; today a forgotten password locks the user out for good. Needs a transactional email provider ([ADR](docs/architecture.md#adr-process): new external dependency).
- [ ] Passkeys (WebAuthn) and optional TOTP two-factor sign-in, required for Teams administrators.
- [ ] Full account export as one archive (places, visits, trips, albums, ledger) plus GeoJSON and KML export of places; the "record you can keep" promise depends on it.
- [ ] Terms of service, privacy policy and a GDPR access request flow, published before the first paid plan.
- [ ] Sign-up abuse protection without third-party captchas (honeypot field and per-IP limits on registration).

## Technical foundation (added 2026-10-23)

- [ ] Contract step of the places and visits split ([ADR 0009](docs/adr/0009-places-and-visits.md)): in a release after visits ship, drop the `markers.travel_date` mirror and its sync triggers, and accept `travelDate` only as an import field.
- [ ] Background jobs in PostgreSQL (`FOR UPDATE SKIP LOCKED` queue) for imports, poster rendering, emails and scheduled threshold alerts, keeping the single service ([ADR 0002](docs/adr/0002-single-service-build-free-frontend.md)).
- [ ] OpenAPI description of the JSON API and a versioning rule, needed before mobile apps or Teams integrations.
- [ ] Type checking of server and browser modules with JSDoc and `tsc --noEmit` in CI, without adding a build step.
- [ ] Performance budget in CI: page weight, map data payload and Web Vitals on a mid-range phone profile; precompressed (Brotli) map data.
- [ ] Recovery for paying users: stated RPO and RTO, a scheduled restore drill from the platform backup, and a logical dump before risky migrations.
- [ ] Service level objectives and alerts for availability and API latency, plus business metrics (places saved, imports, exports, reports generated).
- [ ] Mobile apps (Capacitor wrapper of the PWA) only once the ledger ships, for store discovery and optional background location that records the current country on the device, never raw coordinates on the server.

## Product features (added 2026-10-23)

Everyday features that make the free atlas worth opening again; the paid work above builds on them.

### Map

- [ ] Year slider: replay the map as it was at the end of any year, and filter places by year.
- [ ] Home country and "lived there" status, shown distinctly and counted separately from visits; a "transit only" status for airport layovers that do not count as a visit.
- [ ] Journey lines between consecutive visits, drawn as cartoon arcs, with an animated replay of a trip or a year.
- [ ] Color-blind safe and print-friendly map palettes, chosen in settings.

### Places

- [ ] Ratings, tags (food, hiking, family, work) and a custom emoji per pin, usable as list and map filters.
- [ ] Bulk marking: select several countries on the map or a whole continent from the list in one step.
- [ ] Import from other travel map apps (Been, Visited, Polarsteps exports) with a preview before saving.
- [ ] Wishlist priority and a "when to go" month, with a list of wishlist places sorted by next suitable month.

### Trips

- [ ] Plan a trip from a wishlist place, and let planned trip dates become the ledger's planned stays.
- [ ] Itinerary map: pins and a route per day, and drag-and-drop to reorder slots and days.
- [ ] Multi-destination trips spanning several countries and cities, each with its own dates.
- [ ] Completing a trip turns its destinations into visits with the trip's dates, after the user confirms.
- [ ] Packing list and budget per trip, with expenses in any currency and a total in the home currency.
- [ ] Export an itinerary to a calendar (`.ics`) and as a printable PDF; duplicate a trip as a template.

### Passport and goals

- [ ] Richer passport stats: days abroad per year, longest trip, approximate distance travelled and a countries-per-year timeline.
- [ ] Yearly goals ("three new countries in 2027") with progress on the passport and a celebration when reached.
- [ ] Collections to complete: every capital, every EU country, UNESCO World Heritage sites from open data, with their own badges.
- [ ] "On this day" memories of past visits, shown in the app and, once email exists, in an optional digest.

### Sharing

- [ ] Embeddable public map for blogs and personal sites, read-only and without notes.
- [ ] Choose per place whether it appears on the public map, so a public profile can hide sensitive trips.
