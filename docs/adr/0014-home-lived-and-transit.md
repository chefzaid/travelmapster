# ADR 0014: Home Country, Lived-There And Transit-Only Places

- Status: Accepted
- Date: 2026-10-23

## Context

Every saved place was either "been there" or "wishlist". Travelers asked for more honest
records: the country they live in, the countries they once lived in, and the airports where they
only changed planes. Scratch-map apps commonly count home and lived-in countries among the
countries a traveler has been to, while a layover that never left the airport is not a visit.
These statuses touch the map colors, the passport counts and badges, the public map, imports
and exports, marking several countries at once and the day ledger. The change must keep the
previous-release rollout rule of [ADR 0004](0004-postgres-and-migrations.md), and the map must
tell the statuses apart without relying on color alone.

## Decision

### Model

- **Home country on the account.** `users.home_country` holds one map country code, or none,
  set in the new Settings dialog or from the country's card (`PATCH /api/profile` with
  `homeCountry`). It is not a place: it needs no dates, cannot be hidden or tagged, and there is
  one per traveler. `PATCH /api/profile` now changes only the settings it is sent.
- **Lived there and transit only on the place.** `markers.stay` is `visit` (the default),
  `lived` or `transit`, and only applies to places the traveler has been to: `type` stays
  `visited` or `wishlist`. The API refuses a wishlist place that is lived in or a layover, and
  resets `stay` to `visit` whenever a place moves to the wishlist, so a later "been there" never
  brings back an old home by surprise. In the browser, `public/js/status.js` maps the two fields
  to four statuses: been there, lived there, transit only and wishlist.
- **Place statuses, not visit kinds.** The status belongs to the place because places are
  often marked without any dates (one tap, or a whole continent at once), and the map, the
  passport and the filters all work per place. A city first seen on a layover and visited later
  becomes a visited place; its dated layover stays one of its visits.

### Counting

- **Countries been to** (the passport count, share of the world, continents, ranks, stamps,
  badges and the "Been there" legend number) are the home country plus every country lived in
  or visited, as a country or through a city. **Countries lived in**, home included, are also
  counted on their own in the passport and the legend, and earn an "Expat" badge at two.
- **Transit only does not count**: such a country gets no stamp and adds nothing to ranks or
  badges. The passport lists layovers by name and counts them apart.
- **Visits by year** count visits to places been to on a visit only: stays where the traveler
  lived and layovers are not trips. Cities lived in count toward "cities"; layovers do not.
- **Precedence** for a country with several saved places: home, lived there, visited, transit
  only, then wishlist. A layover therefore wins over a wish, as a visit already did.

### The day ledger

The ledger keeps counting every dated visit of every place, whatever its status
([ADR 0010](0010-day-ledger.md)): days where the traveler lived are presence days, and a dated
layover is a day in that country. Under the default "any part of a day" rule a same-day
layover counts one day; under the midnight rule it counts only the nights spent there, so an
overnight connection counts one and a same-day one none. Counting layovers errs on the safe side
for stay limits; a traveler who stayed airside and wants it left out can keep the layover
without dates. The home country adds no days by itself: days at home are not recorded.

### Map and accessibility

Each status has a fill color, an outline and, for two of them, a pattern, so it still reads in
grayscale and for color-blind travelers: visited is teal with a solid outline (lighter when only
a city was visited), lived there is violet with diagonal stripes and a thick outline, home is
coral with dots and the thickest outline, transit only is pale slate with a dotted outline, and
wishlist stays yellow with a dashed outline. Colors are CSS tokens in both themes; chips,
buttons and tiles keep their text at WCAG AA contrast, and each new outline has at least 3:1
against its fill. Status layers are filtered to the countries that have the status, so the extra
outlines and patterns cost nothing elsewhere. The legend shows "Lived" and "Transit" only when
used, and each toggles like the others; the home country is always drawn. City pins carry the
status color and symbol, and their names say the status to screen readers.

### Sharing, imports and bulk changes

- **Public maps** show whether a place was lived in or a layover (`stay`), like its status. The
  home country is never shared: it says where the traveler lives now, which is why whether a
  stay is still going on is not shared either.
- **Imports and exports** gain a `stay` column (`visit`, `lived` or `transit`); files without it
  import as plain visits.
- **Marking several countries "been there"** turns layovers into visits and leaves countries lived
  in and the home country alone; marking a wishlist skips them and layovers. Bulk status
  changes carry `stay`, so undo restores a layover exactly.

### Rollout

Migration 009 only adds columns with defaults. The previous release never writes them and its
updates leave them as they are; it reads a lived-in or transit place as a plain "been there"
one, so its replicas count layovers as visits until the rollout ends. If it moves a lived-in place
to the wishlist, the column keeps `lived`, so the API reads `stay` only for visited places. Its
`PATCH /api/profile` still requires the visibility, so a new tab saving a home country through
an old replica gets an error and can try again.

## Consequences

- The map, passport and legend tell homes, layovers and visits apart, and the counts match what
  frequent travelers expect from other atlases.
- The day ledger is unchanged and keeps counting every dated day, which the ADR now states.
- Settings that are not places (home country, and later the country list) live on the account
  and go through `PATCH /api/profile`.
- Account settings are not part of the places export; the planned full account export covers
  them.
