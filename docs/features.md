# Features

Everything below is implemented. Planned work lives in [TODO.md](../TODO.md).

## Product Principles

- Keep the map simple and focused on travel tracking.
- Show country borders only: no regions, subdivisions, terrain, roads or tiles.
- Reveal city detail progressively as the user zooms in.
- Be fun and cartoonish, but usable, accessible (WCAG 2.2 AA contrast) and polished.

## The Map

- Cartoon world map drawn from bundled country borders, with pastel countries, thick outlines, a dotted ocean and atlas lines (Equator and tropics).
- Every town and village of 500+ people (about 225,000 places) appears as you zoom in, more at every half zoom step down to street-level zoom 11, where places without room for a name still show as a dot. Capitals carry a star and show first; names never overlap and keep their place as you zoom further in. See [map data](data-model.md#map-data).
- Smooth, continuous zooming like a web map app: everything is drawn on the GPU, and names fade in and out as room opens up; hovering a town or country shows its name.
- Visited countries turn teal, wishlist countries sunny yellow with a dashed border; countries where you only visited a city get a lighter teal.
- The legend doubles as a visited/wishlist filter.
- No third-party map services: map data, fonts and MapLibre GL are served by the app.

## Places

- Click a country or city for a card with flag, capital, population and your saved details.
- One tap marks a place "Been there" or "Wishlist"; tapping again undoes it.
- Instant search over countries and every town, with a world search for anything smaller ([place search](architecture.md#place-search)).
- Notes and a photo link on every place.
- A rating from one to five stars, tags (suggested ones such as food, hiking, family and work,
  or your own) and an emoji per place; the emoji shows on the city's pin and in the places
  list ([ADR 0012](adr/0012-place-details.md)).
- Every visit to a place recorded on its own, with first and last day (or "still there"), notes
  and a photo link; the card lists visits newest first, says how many times you have been
  ("Visited 3 times") and lets you add, edit or remove a visit, with undo. Dates are plain
  calendar days.
- Places list grouped by continent, with filters (including the year of the last visit), text
  search over places, tags and visit notes, and sorting by continent, name or last visit.
- Tag and rating filters that narrow the places list and the map together; the legend shows
  the active filter and clears it in one tap.
- Undo after removing a place, which brings its visits back too.
- Import and export as JSON (visits nested in each place) or CSV (one row per visit), with
  ratings, tags and emoji; import also reads files from before visits or tags existed, and
  skips invalid rows and duplicates.
- "Surprise me" flies to a country you have not visited yet.

## Day Ledger

The Ledger tab turns dated visits into days per country; the map itself stays as it is. The
counting rules are in [ADR 0010](adr/0010-day-ledger.md).

- **Counting rule** chosen by the traveler: *any part of a day* (arrival and departure days count,
  the default) or the *midnight rule* (the day counts where you sleep, so the departure day and
  day trips do not). A city visit counts for its country, once per day.
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
- **Plan ahead**: try planned stays against every rule and threshold they touch before you go.
- **Days per country** for any calendar year or the last 365, 180 or 90 days, and a **timeline**
  of stays per country with the city visits behind them.
- **Alerts** in the app: a badge on the Ledger tab, a list at its top and a reminder after
  signing in.
- **Evidence report** for any country and period: every counted day with the visit it comes from,
  why it counts and the history of that visit's dates, as a printable page (print or save as PDF
  from the browser) or CSV. It is built on the device, only when asked.
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
  public pages. Shared maps are kept out of search results.

## Trips

- Itineraries of up to 30 days with morning, afternoon and evening slots.
- New itineraries are pre-filled with sights, activities and food ideas from Wikivoyage, fetched by the browser.
- A travel-ideas panel for any country or city, and copying an itinerary as text.

## Passport

- Six traveler ranks, from "Armchair traveler" to "Legend of the map", with progress to the next.
- Countries visited, share of the world, continents, cities and trips; per-continent progress bars.
- A stamp for every visited country, 12 badges with a confetti celebration, and a visits-by-year chart counting every visit.

## Accounts And Sharing

- Username and password accounts ([security](security.md#authentication-and-sessions)); change
  the password (signing out other devices) or delete the account and all its data from the
  account menu.
- Private by default; a public map is shared read-only at `/?u=<username>` with visit dates,
  without notes, photo links, ratings, tags or emoji.
- Any place can be hidden from the public map, with its visits, so a public profile keeps
  sensitive trips to itself; the owner's map, passport and ledger still count it
  ([ADR 0013](adr/0013-hidden-places.md)).
- Responsive layout with a bottom sheet on phones, `/` to search, screen-reader labels, and light and dark themes that follow the system.

## Current Boundaries

- No social login yet; a place or visit holds one photo link, not an album ([roadmap](../TODO.md)).
- No paid plans or prices yet; the landing page shows keepsakes as coming soon.
- Photos are links to images hosted elsewhere; the app stores no files.
- Ledger alerts are in-app only: there is no email yet. Overseas territories drawn as part of a
  country on the map (such as French Guiana within France) count as that country, including for
  Schengen. The date history starts with the day ledger release.
