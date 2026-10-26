# Competitive Review

- Reviewed: 2026-10-26. Refresh by 2027-04-26 (every six months), and whenever pricing is set.
- Scope: travel atlases, travel journals, trip planners and residency day trackers, the four
  groups the [roadmap](../TODO.md#market-and-growth-added-2026-10-23) names.

Prices come from public store listings and vendor pages on the review date. They differ by store
and region, and third-party trackers sometimes disagree with the stores, so read them as a range
and check the store before quoting one.

## Atlases

| App | Model and price | What the paid tier adds | Privacy stance |
|---|---|---|---|
| [been](https://apps.apple.com/us/app/680148327) | Free; App Store subscription at about $19.99 a year (also weekly), while another store lists a one-time Premium ([RuStore](https://www.rustore.ru/catalog/app/pro.brouwer.been)) | Regions in 25+ countries, cities and airports, a 3D globe, a chronological map, local profiles, timeline video | Account optional; data synced across devices |
| [Visited](https://apps.apple.com/us/app/visited-map-where-ive-been/id846983349) (Arriving In High Heels) | Free with ads; Pro as a one-time unlock or a monthly or annual subscription ([regional prices](https://apps.apple.com/BR/app/id846983349)) | Regions, cities and airports, no ads | Ads in the free tier |
| Scratch-map apps ([Scratch Map Travel Guide](https://apps.apple.com/us/app/-/id6450149936), [ScratchyMapp](https://apps.apple.com/us/app/scratchymapp/id1548981625), [WorldScratch](https://mwm.ai/apps/worldscratch-travel-map/6790943677)) | Free, some with in-app purchases | Mostly cosmetic | Some store everything on the device, without an account |

**Take-away:** the atlas is a crowded free market, where paid tiers sell finer regions and
visual extras. No atlas counts days per country or produces evidence; none says it works
without third-party map services.

## Journals

| App | Model and price | Keepsakes | Privacy stance |
|---|---|---|---|
| [Polarsteps](https://apps.apple.com/us/app/-/id947925763) | Free app; earns from printed Travel Books (roughly €36 for 24 pages to €116 for 300 in [one review](https://wanderlog.com/blog/?p=695)) and partnerships | Hardback travel book per trip | Automatic background route tracking; trips public, followers-only or private; [summer 2026](https://www.polarsteps.com/news/polarsteps-launches-summer-2026-release-new-tools-for-planning-privacy-and-sharing) added control over live location and route sharing |
| [Journi](https://apps.apple.com/us/app/-/id884030844) | Free; membership about €9.99 a month or €53.99 a year | Photo books from about $19.99–€22.99 ([Journi](https://www.journiapp.com/p/pb/)) | Social travel blog by default |

**Take-away:** keepsakes pay well, but they depend on phone tracking and photos on the vendor's
servers. A book or poster from a private, dated atlas is not on offer.

## Planners

| App | Model and price | Notes |
|---|---|---|
| [Wanderlog](https://apps.apple.com/NG/app/id1476732439) | Free; Pro around $39.99 a year by [one tracker](https://recurdash.com/subscription-pricing/wanderlog), store prices vary widely | Collaborative itineraries, maps per day, AI features in Pro |
| TripIt | Free; Pro around $49 a year by a [2026 comparison](https://www.usecarly.com/blog/tripit-alternatives/) | Itineraries from booking emails, flight alerts, points tracking |

**Take-away:** planners own the itinerary; they forget a trip once it has happened. Turning a
completed trip into dated visits, and planned dates into ledger checks, is TravelMapster's
bridge between the two.

## Residency Day Trackers

| App | Model and price | Notes |
|---|---|---|
| [TaxBird](https://www.apppricinglab.com/app/google_play/com.ware2now.taxbird) | $4.99 a month or $39.99 a year, 30-day trial | Residency day counting from location |
| [Sarmiza (Tax Residency Tracker)](https://apps.apple.com/us/app/-/id6447767254) | Yearly plans about $47.99–$79.99, lifetime $99 | Minimum and maximum day limits for any country |
| [Tax Resident – Days Tracker](https://apps.apple.com/app/id1510629340) | Free with in-app purchases | Days per country |
| Adviser and employer tools (such as Monaeo) | Sold to firms; no public price found on the review date | Employer mobility and tax compliance |

**Take-away:** trackers charge $40–$100 a year and are dry, single-purpose tools. Most rely on
continuous location tracking. None pairs the count with an atlas people enjoy opening, and few
publish how a day is counted.

## Gaps TravelMapster Targets

1. **A fun atlas and a dependable ledger in one place**: the atlas wins people for free; the
   ledger (Schengen 90/180, visa rules, tax thresholds, evidence reports) earns the subscription,
   priced against the $40–$100 trackers ([ADR 0017](adr/0017-product-principles.md)).
2. **Privacy as a feature**: no third-party map services or analytics, counting on the device,
   town-level coordinates and a full export ([ADR 0018](adr/0018-product-metrics.md)). Most
   competitors track location continuously or keep photos on their servers.
3. **Keepsakes from the record, not from tracking**: posters and travel books made from dated
   visits, without background GPS.
4. **Teams without surveillance**: employers see business-travel day counts only, where
   adviser tools today ask for employees' full location history.
5. **Planning that ends in the record**: a dated trip is checked in the ledger before departure
   and becomes visits after it.

## Watch List

- Atlases adding day counts (been or Visited adding a Schengen view) would erode gap 1.
- Polarsteps' privacy work narrows gap 2 for journals.
- Price moves of residency trackers set the ceiling for Pro.
