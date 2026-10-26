# Features

Everything below is implemented. Planned work lives in [TODO.md](../TODO.md).

## Product Principles

- Keep the map simple and focused on travel tracking.
- Show country borders only: no regions, subdivisions, terrain, roads or tiles.
- Reveal city detail progressively as the user zooms in.
- Be fun and cartoonish, but usable, accessible (WCAG 2.2 AA contrast) and polished.
- Keep ledger, keepsake and team features off the map, in their own tabs, dialogs and pages.
- Make every count reproducible from dated visits and a stated rule, explain each counted day,
  and flag missing dates instead of guessing; the app is a record, not legal or tax advice.
- Let people keep their record: every plan, free included, can take all its data away in open
  formats, and precise coordinates are reduced to a city and country before they are stored.
- Keep the atlas free: paid plans add capacity, records and keepsakes, never ads, third-party
  trackers or map services, and never lock away data a user already has.
- In Teams, an employer sees business-travel day counts only, never personal trips.

The reasoning and what each rule rules out are in [ADR 0017](adr/0017-product-principles.md).

## The Map

- Cartoon world map drawn from bundled country borders, with pastel countries, thick outlines, a dotted ocean and atlas lines (Equator and tropics).
- Every town and village of 500+ people (about 225,000 places) appears as you zoom in, more at every half zoom step down to street-level zoom 11, where places without room for a name still show as a dot. Capitals carry a star and show first; names never overlap and keep their place as you zoom further in. See [map data](data-model.md#map-data).
- Smooth, continuous zooming like a web map app: everything is drawn on the GPU, and names fade in and out as room opens up; hovering a town or country shows its name.
- Visited countries turn teal, wishlist countries sunny yellow with a dashed border; countries where you only visited a city get a lighter teal.
- Your home country is coral with dots and a thick outline, countries you lived in are violet
  with stripes, and airport layovers ("transit only") are pale with a dotted outline, so every
  status differs by pattern or outline as well as color ([ADR 0014](adr/0014-home-lived-and-transit.md)).
- The legend doubles as a filter for each status.
- **Timeline** (opened from the legend): a year slider replays the map as it was by the end of
  any year, or shows only the places visited during it, from the visit dates. Places without
  dates and wishlist places are left out (the timeline says how many lack dates), places lived
  in and layovers follow their dated stays, and the home country, which has no dates, is always
  drawn. It works with the keyboard, on phones and on public maps
  ([ADR 0016](adr/0016-timeline-journeys-and-palettes.md)).
- **Journey lines**, switched on in the timeline: dashed cartoon arcs with arrows between
  consecutive visits (a city visit at the city, a visit to a whole country at its label), and
  an animated replay of the year or of one trip, which can be stopped and is drawn at once
  with reduced motion.
- **Map palettes** chosen in Settings: cheerful (standard), color-blind safe and
  print-friendly, each tested for WCAG AA label contrast and, for the last two, for statuses
  that stay apart with every kind of color vision and in grayscale.
- **Printing the map** ("Print my map", or the browser's print) gives a landscape page with
  the map as shown, a title and the legend, without the controls.
- **Posters**: "Make a poster" in the account menu downloads the map as a vector file (SVG) in
  A4, A3, A2, 50 × 70 cm or 18 × 24 in, cartoon, ink-on-paper or night style, with a title, the
  number of countries and a legend; every country keeps its true size (Equal Earth projection).
  Printing to order is not offered yet.
- No third-party map services: map data, fonts and MapLibre GL are served by the app.

## Places

- Click a country or city for a card with flag, capital, population and your saved details.
- One tap marks a place "Been there", "Lived there", "Transit only" or "Wishlist"; tapping
  again undoes it. A layover is shown but never counted as a visit.
- A home country, set in Settings or from its card; it is never shown on a public map.
- The list of countries to count, in Settings: every territory on the map (248, the default) or
  UN members and observer states (195). Territories outside the list, such as Kosovo, Taiwan or
  Greenland on the UN list, are still colored in and named in the passport, but not counted; the
  rule for disputed territories is in [ADR 0015](adr/0015-country-lists.md). Overseas parts of
  France, Norway and the Netherlands that are outside the Schengen area (French Guiana,
  Guadeloupe, Martinique, Réunion, Mayotte, Svalbard, the Caribbean Netherlands) are territories
  of their own, and count as their member on the UN list
  ([ADR 0024](adr/0024-overseas-territories.md)).
- Mark many countries at once: pick them on the map (or through search), or choose a whole
  continent in the Places tab, then mark them "Been there" or "Wishlist" in one step, with undo.
  Countries you have been to never become wishlist ones; marking "Been there" turns layovers
  into visits and leaves your home and countries you lived in as they are.
- Instant search over countries and every town, with a world search for anything smaller ([place search](architecture.md#place-search)).
- Notes and a photo link on every place.
- A rating from one to five stars, tags (suggested ones such as food, hiking, family and work,
  or your own) and an emoji per place; the emoji shows on the city's pin and in the places
  list ([ADR 0012](adr/0012-place-details.md)).
- Every visit to a place recorded on its own, with first and last day (or "still there"), notes
  and a photo link; the card lists visits newest first, says how many times you have been
  ("Visited 3 times") and lets you add, edit or remove a visit, with undo. Dates are plain
  calendar days.
- Places list grouped by continent, with filters (status, including lived there and transit
  only, and the year of the last visit), text
  search over places, tags and visit notes, and sorting by continent, name, last visit or when
  to go.
- Wishlist plans: a priority (must go, would love to, someday) and the best months to go; the
  places list can show the wishlist by the next month that suits each place, highest priority
  first, and the Explore tab suggests the place in season soonest.
- Tag and rating filters that narrow the places list and the map together; the legend shows
  the active filter and clears it in one tap.
- Undo after removing a place, which brings its visits back too.
- Export places as GeoJSON or KML for other map apps, GIS tools and Google Earth.
- **Import from other travel apps**, with a preview to untick what to leave out: a Polarsteps
  data export (its ZIP file, read without loading the photos, or the `trip.json` files in it),
  where each step becomes a visit to its town until the next step; or a pasted list of
  countries from Been, Visited or anywhere. Places already on the map only get the visits they
  lack.
- Import and export as JSON (visits nested in each place) or CSV (one row per visit), with
  ratings, tags, emoji, wishlist plans and whether a place was lived in or a layover; import
  also reads files from before visits or tags existed, and
  skips invalid rows and duplicates.
- "Surprise me" flies to a country you have not visited yet.
- **On this day**: the Explore tab lists visits and moves that began on today's date in earlier
  years ("2 years ago today, you arrived in Lisbon"), each showing its place on the map; a visit
  that began on 29 February comes back on 28 February in other years. Layovers and wishes are
  left out.

## Day Ledger

The Ledger tab turns dated visits into days per country; the map itself stays as it is. The
counting rules are in [ADR 0010](adr/0010-day-ledger.md).

- **Counting rule** chosen by the traveler: *any part of a day* (arrival and departure days count,
  the default) or the *midnight rule* (the day counts where you sleep, so the departure day and
  day trips do not). A city visit counts for its country, once per day.
- **Every dated day counts**, whatever the place's status: days where you lived are presence
  days, and a dated layover counts as a day there (under the midnight rule, only a night spent
  there) ([ADR 0014](adr/0014-home-lived-and-transit.md)).
- **Open-ended stays**: a visit can be marked "I'm still there" and counts through today; a visit
  without a last day otherwise counts its first day only and is flagged so it can be completed.
- **Schengen 90/180 calculator**: days left today, days used in the last 180, overstays, and how
  long you could stay from any entry day. Members as of 2026, including Bulgaria and Romania;
  Monaco, San Marino and the Vatican count, Cyprus, Ireland and Andorra do not.
- **Your own stay rules**: "N days in any M-day window" for a country or a group of countries,
  such as a visa limit.
- **Tax residency**: 183 days in the calendar year for each country, plus your own thresholds over
  a year starting on any day (such as the UK tax year from 6 April) or a rolling window. Each one
  warns ahead of time, including when a stay still going on would reach it.
- **Plan ahead**: try planned stays against every rule and threshold they touch before you go,
  typed in or taken from a dated trip.
- **Days per country** for any calendar year or the last 365, 180 or 90 days, and a **timeline**
  of stays per country with the city visits behind them.
- **Alerts** in the app: a badge on the Ledger tab, a list at its top and a reminder after
  signing in.
- **Evidence report** for any country and period: every counted day with the visit it comes from,
  why it counts and the history of that visit's dates, as a printable page (print or save as PDF
  from the browser) or CSV. It is built on the device, only when asked.
- The tab and the report say they are a guide, not legal or tax advice
  ([ADR 0017](adr/0017-product-principles.md)), and the tab states how ledger data is kept:
  places at town or country level, counting and reports on the device, and the server's copy
  never public and deleted with the account.
- **Date history**: every visit date added, changed or removed is kept, with when, even after the
  visit or place is gone.

## Public Pages

Pages for visitors without an account ([ADR 0011](adr/0011-public-pages.md)).

- **Landing page**: signed-out visitors see the atlas, day ledger and keepsakes story, the plans
  (free today; keepsakes coming soon) and the sign-up form, over a live demo map of a sample
  traveler. They can color places in on it, and the ledger story counts the sample traveler's
  Schengen days live; nothing is saved. Signed-in visitors land on their own map, and shared
  maps open read-only as before.
- **Free Schengen 90/180 calculator** at `/schengen-calculator`, without an account: past and
  planned stays (or "still there"), days used and left on any day, overstays with the stays
  that cause them, and the latest day you can stay. It counts with the same rules as the Ledger
  tab, and the dates never leave the browser tab. The page explains the rule, lists the members
  and links to sign-up.
- Search-friendly: real titles, descriptions and headings, `robots.txt` and a sitemap of the
  public pages. Shared maps stay out of search results unless their owners turn on **Let search
  engines list my public map** in Settings; the sitemap then lists them.
- **Link previews of shared maps**: a shared map's link shows its own title, its counts and a
  picture of the map with the countries colored in, when posted in a chat or on social media
  ([ADR 0023](adr/0023-shared-map-previews-and-indexing.md)). The shared map invites visitors to
  make their own.

## Trips

- Itineraries of up to 30 days with morning, afternoon and evening slots.
- New itineraries are pre-filled with sights, activities and food ideas from Wikivoyage, fetched by the browser.
- A travel-ideas panel for any country or city, and copying an itinerary as text.
- Exporting an itinerary to a calendar: an `.ics` file with an all-day event per day holding
  that day's plans (it needs a start date), which any calendar app imports.
- A printable itinerary, one row per day, to print or save as PDF from the browser.
- Duplicating a saved trip as a template: the same days, plans and packing list (unpacked),
  named "(copy)", without dates or expenses.
- **Packing list**: items to tick off as they are packed, your own or a set of basics (passport,
  charger, plug adapter…), shown on the printed itinerary as a checklist.
- **Budget**: expenses by category (transport, stay, food and drink, activities, other) in any
  currency, totalled in the traveler's home currency with the exchange rate they enter for each
  other currency (the rate they actually got; no rate service is called), against an optional
  planned budget. Expenses in a currency without a rate are left out of the total, and the
  budget says which rates are missing.
- Planning a trip from a wishlist place, from its card or the 🗓️ button in the places list.
- **Plan in ledger**: a dated trip becomes a planned stay in the day ledger, in the country of its
  destination ("Lisbon, Portugal", "Japan" or a town such as "Kyoto"), so the Ledger tab checks
  it against every stay rule and threshold. The planned stay follows the trip when its dates
  change and goes when the trip is deleted.
- **Record as a visit**: once a trip has begun, its destination gets a visit with the trip's
  dates, after the traveler confirms: on the saved town or country (a wishlist place becomes
  "been there") or on a new place. The trip then shows it is recorded.

## Passport

- Six traveler ranks, from "Armchair traveler" to "Legend of the map", with progress to the next.
- Countries been to (your home country, countries you lived in and those you visited), share of
  the world (or of UN countries), continents, cities and trips, all counted on your chosen
  country list; countries lived in and layovers counted on their own; per-continent progress
  bars.
- **Collections** to complete, counted on the chosen country list: the capital of every country
  (a country with several capitals counts once, for any of them) and every member of the
  European Union, with what is left once only a few remain.
- A stamp for every country been to, marked "Home" or "Lived" where it applies, 16 badges (three
  of them for collections: 10 and 50 capitals, and the whole European Union) with
  a confetti celebration, and a visits-by-year chart counting every visit (stays where you lived
  and layovers are not visits).
- **Goals** for a year, such as "three new countries in 2027": new countries (on the chosen
  list) or new cities first visited that year, or trips begun in it, with a progress bar each
  and a confetti celebration when one is reached. One goal per kind and year; goals are never
  on the public map.
- **Share a picture**: square cards (1080 × 1080) of the country count, the passport stamps or
  this year's recap, shared through the phone's share sheet or downloaded as PNG. They show
  counts, country names and flags only: never notes, photos, places or dates.
- **On the road**, from dated visits: days abroad this year and per year (days outside the home
  country, counted by the ledger's day rule; every recorded day when no home country is set), the
  longest trip (stays away from home no more than three days apart, layovers included, places
  lived in left out), the approximate distance traveled (straight lines between every place been
  to, in the order of the visits, also told as times around the Earth) and countries per year
  with how many were new.

## Accounts And Sharing

- Username and password accounts ([security](security.md#authentication-and-sessions)); change
  the password (signing out other devices) or delete the account and all its data from the
  account menu.
- **Download all my data** in the account menu: one ZIP archive with everything the account
  holds (`account.json`: profile and settings, places and visits, trips, ledger settings and the
  whole date history) and the places as CSV, GeoJSON and KML, with a README
  ([ADR 0017](adr/0017-product-principles.md)).
- Private by default; a public map is shared read-only at `/?u=<username>` with visit dates and
  whether a place was lived in or a layover, counted on the owner's country list, without notes,
  photo links, ratings, tags, emoji, wishlist plans or the home country. Visitors can use the
  timeline, pick their own map colors and print the map; journey lines show only when the owner
  turns them on in Settings ([ADR 0016](adr/0016-timeline-journeys-and-palettes.md)).
- **Embed** a public map in a blog or personal site: the account menu copies an `<iframe>` of
  `/embed/<username>`, a read-only map with the owner's name, countries and cities and a link to
  the full map; it shows nothing while the map is private ([ADR 0020](adr/0020-embeddable-map.md)).
- Any place can be hidden from the public map, with its visits, so a public profile keeps
  sensitive trips to itself; the owner's map, passport and ledger still count it
  ([ADR 0013](adr/0013-hidden-places.md)).
- **Install it** on a phone or computer from the browser, and open it offline: the map, its data
  and your places, trips and ledger as last loaded; changes wait until you are back online, and
  signing out removes the offline copy ([ADR 0021](adr/0021-installable-offline-app.md)).
- Responsive layout with a bottom sheet on phones, `/` to search, screen-reader labels, and light and dark themes that follow the system.

## Current Boundaries

- No social login yet; a place or visit holds one photo link, not an album ([roadmap](../TODO.md)).
- No paid plans or prices yet; the landing page shows keepsakes as coming soon.
- Photos are links to images hosted elsewhere; the app stores no files.
- Ledger alerts are in-app only: there is no email yet. The date history starts with the day
  ledger release. A rule for a country does not count its overseas territories that the map
  draws on their own (such as Réunion for France): add them to the rule to count them together.
- The map has no towns yet in the overseas territories split from France, Norway and the
  Netherlands; they come with the next full map data rebuild.
