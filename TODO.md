# Roadmap

Planned work only; shipped behavior is listed in [features](docs/features.md). Keep the
[product principles](docs/features.md#product-principles) when adding features, and record
material design changes as an [ADR](docs/architecture.md#adr-process).

- [ ] Google and Facebook login, linked to existing accounts ([ADR 0003](docs/adr/0003-sessions-and-csrf.md))
- [ ] Travel albums: give each pinned place a description and a photo album instead of a single photo link
- [ ] Multiple visits per place: record each visit with its own dates, description and photos, and show how many times you have been

## Product direction (added 2026-10-04)

TravelMapster is a playful travel atlas; many apps already color visited countries. The niche to own is **the travel record you can rely on and keep**: the cartoon atlas stays, but every visit carries dates, so the app also counts days per country — Schengen 90/180, visa stay limits, tax-residency thresholds — for digital nomads, expats and frequent business travellers. It also turns travels into keepsakes: printed posters and travel books. A Teams tier lets companies track employees' business-travel days for tax and social-security obligations without seeing personal trips.

Differentiators:

1. A fun atlas and a dependable day ledger in one place.
2. History filled automatically from location exports and photos, processed privately.
3. Physical keepsakes from the same map.
4. No third-party map services (existing principle), which makes the privacy promise credible.

### Principles

- [ ] **ADR — product principles:** extend the [product principles](docs/features.md#product-principles) to cover the day ledger, keepsakes and paid tiers while keeping the map itself simple (country borders and towns only, no tiles).

### Day ledger (builds on multiple visits per place)

- [ ] Visit timeline with entry and exit dates per country and city; travel days counted by a documented, selectable rule.
- [ ] Day counters per country per calendar year or rolling window, and a Schengen 90/180 calculator showing remaining days, with simulation of planned trips; configurable rules for other visa regimes.
- [ ] Tax-residency thresholds (183 days and user-defined) with alerts before they are reached, and a day-by-day evidence report (PDF and CSV) listing the source of each day.
- [ ] Edit history for visit dates, so evidence reports show what changed and when.
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
