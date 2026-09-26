# TravelMapster

![HTML](https://img.shields.io/badge/HTML-E34F26?logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000)
![Node.js](https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-map-199900?logo=leaflet&logoColor=white)
![Passport](https://img.shields.io/badge/Passport-auth-34E27A?logo=passport&logoColor=000)

TravelMapster is a playful travel atlas. Color in the countries you have visited, pin the cities you love, keep a wishlist of dream trips, and plan day-by-day itineraries.

## Features

### The map
- [x] Cartoon world map drawn from country borders only: no tiles, terrain, roads or regional detail
- [x] Pastel countries with thick friendly outlines, a dotted ocean and atlas lines (Equator and tropics)
- [x] Country names and main cities appear as you zoom in, with labels that never overlap
- [x] Capitals marked with a star; only capitals and large cities are shown
- [x] Visited countries turn teal, wishlist countries turn sunny yellow with a dashed border
- [x] Countries you only visited a city in get a lighter teal
- [x] Map legend doubles as a filter for visited and wishlist places
- [x] Works offline from the server: map data and fonts are bundled, no third-party tiles

### Places
- [x] Click any country or city for a card with flag, capital, population and your saved details
- [x] One tap to mark a place as "Been there" or "Wishlist" (tap again to undo)
- [x] Search countries and main cities instantly, with a world search fallback for smaller towns
- [x] Notes, travel dates and photo links on every place
- [x] Places list grouped by continent, with filters, search and sorting
- [x] Undo after removing a place
- [x] Import and export as JSON or CSV (duplicates are skipped on import)
- [x] "Surprise me" flies you to a country you have not visited yet

### Trips
- [x] Plan trips with morning, afternoon and evening slots for up to 30 days
- [x] Itineraries are pre-filled with sights, activities and food ideas from Wikivoyage
- [x] Travel ideas panel for any country or city
- [x] Copy an itinerary as text

### Passport
- [x] Traveler rank and progress to the next rank
- [x] Countries visited, share of the world, continents, cities and trips
- [x] Per-continent progress bars
- [x] Passport stamps for every visited country
- [x] 12 badges to unlock, with a confetti celebration
- [x] Trips by year chart

### Account and sharing
- [x] Username and password accounts
- [x] Public or private travel map, with a read-only share link (`/?u=username`); notes and photos stay private
- [x] Responsive layout with a bottom sheet on phones, keyboard shortcuts (`/` to search) and screen reader labels
- [x] Light and dark themes that follow the system setting

### Next
- [ ] Google and Facebook login

## Map Requirements

- Keep the map simple and focused on travel tracking.
- Show only countries borders, not regions or other subdivisions.
- Avoid too much detailed terrain and map noise.
- Show more city-level detail only when zoomed in.
- Fun and cartoonish, but still usable and polished.

## Project structure

```text
server.js              Express API (auth, places, trips, public maps)
public/                Everything the browser loads (the only folder served)
  index.html           App shell
  styles.css           Cartoon design system
  js/app.js            App wiring: auth, map cards, search, tabs
  js/map.js            Leaflet map: countries, labels, cities and pins
  js/geo.js            Country lookup, stats, ranks and badges (pure, unit tested)
  js/places.js         Places tab and import/export
  js/trips.js          Trip planner
  js/passport.js       Passport tab
  js/ideas.js          Wikivoyage ideas and itinerary builder
  data/                Country borders and main cities (Natural Earth, public domain)
  vendor/              Leaflet and fonts (Fredoka, Nunito; SIL OFL)
scripts/build-map-data.js  Rebuilds public/data from Natural Earth
test/                  API and frontend unit tests (node --test)
```

### Rebuilding the map data

Download `ne_50m_admin_0_countries.geojson` and `ne_50m_populated_places_simple.geojson` from
[Natural Earth](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson) into a folder, then run:

```bash
node scripts/build-map-data.js path/to/folder
```

## Run Locally

Requires Node.js `22.5.0` or newer.

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```
