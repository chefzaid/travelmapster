# TravelMapster

![HTML](https://img.shields.io/badge/HTML-E34F26?logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000)
![Node.js](https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-map-199900?logo=leaflet&logoColor=white)
![Passport](https://img.shields.io/badge/Passport-auth-34E27A?logo=passport&logoColor=000)

TravelMapster is a simple travel map app for tracking places you have visited and places you want to visit.

Log in, add pins to a world map, and save your travel data.

## Features

- [x] Interactive world map
- [x] User registration and login with username/password
- [x] Logout support
- [x] Save user markers in SQLite
- [x] Load saved markers after login
- [x] Add visited places
- [x] Add wishlist places
- [x] Use different marker colors for visited and wishlist pins
- [x] Pin countries by clicking on the map
- [x] Pin countries by entering a country name
- [x] Pin cities by entering a city name
- [x] Country autocomplete list
- [x] City suggestions using Nominatim/OpenStreetMap
- [x] Remove saved pins
- [x] Highlight visited countries on the map
- [ ] Add Google and Facebook login
- [ ] Add a proper homepage with travel visuals
- [ ] Add a simple TravelMapster logo
- [ ] Improve the UI with Bootstrap or a cleaner custom layout
- [ ] Show major cities when zooming in
- [ ] Use a simplified map theme
- [ ] Add a profile page
- [ ] Add travel suggestions by country
- [ ] Add city/place sight suggestions
- [ ] Generate itinerary suggestions by city/country, number of days, and time of day (morning, afternoon, evening)
- [ ] Let users build and save custom itineraries
- [ ] Add marker editing instead of delete-and-recreate only
- [ ] Add tests for auth, marker storage, and map API routes
- [ ] Add notes to each pin
- [ ] Add travel dates to visited places
- [ ] Add filters for visited, wishlist, countries, and cities
- [ ] Add a search box that jumps to saved pins
- [ ] Add basic trip statistics, such as countries visited and cities saved
- [ ] Export saved places as JSON or CSV
- [ ] Import saved places from JSON or CSV
- [ ] Add private/public profile settings
- [ ] Add image uploads or photo links for visited places

## Map Requirements

- Keep the map simple and focused on travel tracking.
- Show only countries borders, not regions or other subdivisions.
- Avoid too much detailed terrain and map noise.
- Show more city-level detail only when zoomed in.

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
