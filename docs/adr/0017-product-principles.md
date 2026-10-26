# ADR 0017: Product Principles For The Ledger, Keepsakes And Paid Tiers

- Status: Accepted
- Date: 2026-10-26

## Context

The [product principles](../features.md#product-principles) were written for the atlas alone:
a simple, cartoonish map of borders and towns. The product direction in the
[roadmap](../../TODO.md#product-direction-added-2026-10-04) adds three things: a day ledger that
people rely on for Schengen, visa and tax-residency limits ([ADR 0010](0010-day-ledger.md)),
keepsakes made from the map (posters, recaps, travel books), and paid tiers (Pro and Teams). Each
one brings pressure that could erode the atlas: more layers on the map, trust and privacy claims
that need to hold, and paywalls. Future features need one shared rule set to be judged against.

## Decision

The product principles in `docs/features.md` keep the four map rules and add rules in four
groups:

- **The map stays simple.** Ledger, keepsake and team features live in their own tabs, dialogs
  and pages. The map shows country borders and towns only, with no tiles, roads, terrain or
  subdivisions; keepsakes print the same map.
- **A record you can rely on.** Every count is reproducible from the user's dated visits and the
  stated rule (day rule, window, threshold), and the app explains each counted day. It never
  guesses a missing date: a gap is flagged for the user to fill. The app is a record and an
  early warning, not legal or tax advice, and says so where a count matters.
- **A record you can keep.** People can take all their data with them in open formats on every
  plan, free included, and deleting the account deletes it. Precise coordinates are reduced to a
  city and country before they reach the server, unless the user chooses otherwise.
- **Fair paid tiers.** The atlas stays free: anything free today stays free. Paid plans add
  capacity, records and keepsakes; they never hold the user's existing data hostage, show ads,
  or add third-party trackers or map services. Limits are enforced on the server.
- **Teams see work, not lives.** An employer sees only business-travel day counts per country
  for its travelers; personal trips, places, notes and photos stay private to the traveler.

## Consequences

- A feature that adds a map layer, needs a third-party map or analytics service, or puts
  existing free behavior behind a plan needs a new ADR that supersedes this one.
- Export (full account archive, GeoJSON and KML) and the privacy statement for the ledger become
  conditions for the first paid plan, not later extras.
- The Schengen calculator already says it is a guide, not legal advice; the Ledger tab and the
  evidence report need the same note ([roadmap](../../TODO.md#day-ledger-builds-on-the-ledger-tab-adr-0010)).
- Teams data needs its own boundary in the data model: a business flag on visits and a
  per-organization view that cannot reach personal ones.
