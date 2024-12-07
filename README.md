## TravelMapster

**Requirements:**
- Name: **TravelMapster**
- Frontend: **HTML**, **CSS**, **JavaScript**
- Backend: **Node.js**
- Database: **SQLite**
- UI Framework: **Bootstrap** (with a simple logo)
- Homepage:
  - Page-wide video of traveling
  - Page-wide horizontal icons with travel themes
  - Three columns (each with an image and title):
    1. **Travel Map**
    2. **Travel Suggestions**
    3. **Itinerary Planning**
- Login options: Email/Password, Google, Facebook
- Data persisted in DB

**Map Requirements:**
- Simple 2D map with country frontiers only
- Zooming in reveals major cities
- Cartoonish and approximate representation
- No roads, rivers, or landscape features

---

### V1: Travel Map
- Interactive map to pin visited countries or wishlist destinations
- Two pin types: **Visited** and **Wishlist** (distinct icons)
- Add/remove pins
- Two textboxes on the left: 
  - One for countries
  - One for cities
- Pin countries by:
  - Clicking on the map  
  - Entering the country name
- Pin cities only by entering city names

### V2: Travel Suggestions
- Suggest places to visit in a given country
- Suggest sights in a specific city/place
- Suggest itineraries given:
  - City
  - Number of days
  - Times of day (morning, afternoon, evening, night)
- Enriched profile page

### V3: Itinerary Planning
- Plan travel itineraries from scratch or based on suggestions
