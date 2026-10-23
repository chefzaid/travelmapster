# ADR 0016: Map Timeline, Journey Lines And Palettes

- Status: Accepted
- Date: 2026-10-23

## Context

Dated visits ([ADR 0009](0009-places-and-visits.md)) let the map do more than show where a
traveler has been: it can show how the map filled up year by year and the order of their
trips. The roadmap asked for a year slider, journey lines between consecutive visits with an
animated replay, and map palettes that are safe for color-blind travelers and good on paper.
All three touch the map, which the [product principles](../features.md#product-principles)
keep simple, and the public map, which already shares visit dates but not where a traveler is
now. Rendering stays in MapLibre GL ([ADR 0008](0008-maplibre-gl.md)) with no third-party
services.

## Decision

### The timeline

- **One opt-in control.** A "Timeline" button in the legend opens a bar over the map with a
  year range, a choice between "Been by the end of" and "Visited during" the year, and the
  journey lines. Closed, the map is exactly as before; nothing is remembered between visits.
  The range is a native `input type="range"`, so arrows, Page Up and Down, Home and End and
  touch all work; it says "By the end of 2019" or "During 2019" to screen readers, and a
  live summary counts the countries shown.
- **By the end of a year** draws each place been to that has a visit starting on or before
  31 December, with only those visits. **During a year** draws places with a visit that
  overlaps it; a stay still going on lasts until today and a visit without a last day covers
  its first day, as in the [day ledger](0010-day-ledger.md).
- **Places without dates are left out** while the timeline is open: there is no way to know
  when they were visited, and drawing them in every year would hide the history the timeline
  is for. The summary says how many are left out, so the traveler can add dates. When no
  visit has a date, the timeline says so and leaves the map as it is.
- **Wishlist places are left out**: they are plans, not history.
- **Lived there and transit only** follow their dated stays like visits, keeping their own
  colors ([ADR 0014](0014-home-lived-and-transit.md)). A country lived in from 2015 to 2018 is
  on the map by the end of every year from 2015, and during 2015 to 2018 only.
- **The home country has no dates** and is where the traveler lives now, so it is drawn in
  every year, as the legend always draws it; the summary counts it by the end of a year but
  not during one. Public maps never include it.
- The legend counts, the passport and the day ledger keep counting every place; the tag and
  rating filter and the legend toggles still apply on top of the timeline.

### Journey lines

- **Stops in order.** Every dated visit of the places shown is a stop, ordered by first day,
  then last day (so a same-day layover comes before the stay that starts that day). A city
  visit is at the city; a visit to a whole country is at the country's label point, and adds
  no stop when it overlaps a visit to a city in that country, which says more. Back-to-back
  visits to one place are one stop. Lines join consecutive stops at different points.
- **Cartoon arcs**: each leg is a quadratic curve bending to the left of the way traveled,
  drawn as a dashed line on a light casing with an arrow in the middle, so outbound and return
  legs draw side by side and every line keeps 3:1 against its casing.
- **Off by default.** Lines show only while the timeline is open and the "Journey lines"
  switch is on, for the places it shows, so the everyday map stays simple.
- **Replay** of a whole year, or of one trip of it: a run of stops with at most three days
  between leaving one place and reaching the next. The camera frames the route, then each leg
  draws in turn with a moving dot. The replay can be stopped at any time (WCAG 2.2.2), and
  only its start and end are announced, with the route in words. With
  `prefers-reduced-motion`, the camera jumps and the route is drawn at once.
- Pure logic lives in `public/js/timeline.js` and `public/js/journeys.js`, unit tested in Node.

### Public maps

The timeline works on public maps from the visit dates they already share. Journey lines
reveal nothing a determined reader could not work out from those dates, but they make the
order of a traveler's trips obvious at a glance, so visitors see them only when the owner turns
on "Show journey lines on my public map" in Settings (`users.public_journeys`, off by default).
The public API returns it as `showJourneys`; still-going-on stays, the home country and hidden
places stay private as before ([ADR 0013](0013-hidden-places.md)).

### Palettes

- **Three palettes**, chosen in Settings: the cheerful standard one, a color-blind safe one
  built from the Okabe-Ito hues on neutral land, and a print-friendly one with the same safe
  hues on white paper and black ink. The colors are CSS token overrides under
  `html[data-palette]` in `styles.css`, so the map, legend, pins, chips and stamps change
  together; the map redraws its style from the tokens. Statuses keep their outlines and
  patterns in every palette.
- **Stored on the account** (`users.map_palette`, migration 011) so it follows the traveler
  across devices, and mirrored in this browser's storage so the next visit starts in the right
  colors before the account loads. Visitors of public maps choose their own palette in the
  public panel, kept in their browser; the owner's choice is not shared, since it is about the
  viewer's eyes.
- **Verified by tests** that read the tokens from `styles.css`: in every palette and theme,
  map labels (`--ink-dark`) keep 4.5:1 on every status fill, soft chip color and land color,
  status outlines keep 3:1 on their fill where ADR 0014 promised it (all of them in the new
  palettes), and journey lines keep 3:1 on their casing. In the color-blind and print palettes,
  every pair of status fills, and every status against every land color, differ by at least
  10 (CIE76) for normal vision and simulated protanopia, deuteranopia and tritanopia. For a
  grayscale printer, visited countries and those seen only through a city (which share an
  outline) differ in lightness, and every status stands out from the land.

### Printing

The map is a WebGL canvas and the pins are page elements, so printing the page as is would
lose them or misplace them. Before printing (the account menu's "Print my map", the public
panel's button, or the browser's own print), the app renders the map synchronously and
composes a picture of it with the ocean and the pins. The print stylesheet shows only that
picture, a title (with the timeline's year when it is open) and the legend, on a named
landscape page, so the evidence report keeps its own portrait print. The picture prints in any
palette; the print-friendly one is made for it.

### Rollout

Migration 011 adds `map_palette` (default `standard`) and `public_journeys` (default false).
The previous release never reads or writes them. Its `PATCH /api/profile` refuses a request
that carries only the new settings, so a new tab saving a palette through an old replica gets
an error and can try again; its public maps send no `showJourneys`, so visitors see no lines.

## Consequences

- The map can replay a traveler's history and trips without adding anything to the everyday
  view, and works on phones, with the keyboard and with reduced motion.
- Undated places are visible in the timeline only as a count, which nudges travelers toward
  adding dates.
- Color-blind travelers and anyone printing get palettes whose safety is checked in CI; the
  standard palette is unchanged.
- Journey lines on public maps are an explicit owner choice.
- A palette is a third place where map colors are defined (with the tokens and the map style),
  so new statuses must be given a color in each palette.
