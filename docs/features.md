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
- Every visit to a place recorded on its own, with first and last day, notes and a photo link;
  the card lists visits newest first, says how many times you have been ("Visited 3 times") and
  lets you add, edit or remove a visit, with undo. Dates are plain calendar days.
- Places list grouped by continent, with filters (including the year of the last visit), text
  search over places and visit notes, and sorting by continent, name or last visit.
- Undo after removing a place, which brings its visits back too.
- Import and export as JSON (visits nested in each place) or CSV (one row per visit); import
  also reads files from before visits existed, and skips invalid rows and duplicates.
- "Surprise me" flies to a country you have not visited yet.

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
  without notes or photo links.
- Responsive layout with a bottom sheet on phones, `/` to search, screen-reader labels, and light and dark themes that follow the system.

## Current Boundaries

- No social login yet; a place or visit holds one photo link, not an album ([roadmap](../TODO.md)).
- Photos are links to images hosted elsewhere; the app stores no files.
