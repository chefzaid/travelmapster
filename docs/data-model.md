# Data Model

PostgreSQL holds all user data. The schema lives in `src/db/migrations/`; field limits are
enforced both there and in `src/validation.js`.

## Relationships

```mermaid
erDiagram
    users ||--o{ markers : saves
    markers ||--o{ visits : "visited on"
    users ||--o| ledger_settings : counts
    users ||--o{ visit_changes : "date history"
    users ||--o{ trips : plans
    users {
        bigint id PK
        text username "unique, case-insensitive"
        text password_hash "bcrypt"
        text profile_visibility "private | public"
    }
    markers {
        bigint id PK
        bigint user_id FK
        float lat
        float lng
        text type "visited | wishlist"
        text category "Country | City"
        text name
        text photo_url
        text notes
        smallint rating "1-5, optional"
        text_array tags "up to 8"
        text emoji "one emoji, optional"
        date travel_date "mirror of the latest visit until the contract step"
    }
    visits {
        bigint id PK
        bigint marker_id FK
        date start_date
        date end_date "optional, on or after start"
        boolean ongoing "still there; only without an end date"
        text notes
        text photo_url
    }
    ledger_settings {
        bigint user_id PK
        text day_rule "presence | midnight"
        jsonb rules "stay rules and thresholds"
        jsonb planned "planned stays"
    }
    visit_changes {
        bigint id PK
        bigint user_id FK
        bigint visit_id "no foreign key: outlives the visit"
        text place_name "at the time"
        text action "added | changed | removed"
        date old_start_date
        date new_start_date
        timestamptz changed_at
    }
    trips {
        bigint id PK
        bigint user_id FK
        text title
        text destination
        date start_date
        jsonb plan "array of days"
    }
```

## Tables

| Table | Contents and rules |
|---|---|
| `users` | `username` is 3–32 of `A-Z a-z 0-9 _ . -`, unique regardless of case. Passwords are 8–72 bytes and stored only as bcrypt hashes (cost 12). `profile_visibility` defaults to `private`. |
| `markers` | A saved place ("marker" in the API). `name` 1–200 characters, `notes` up to 2,000, `photo_url` an HTTP(S) URL up to 2,048. Coordinates are range-checked. `rating` is 1–5 or empty; `tags` holds up to 8 lowercase tags of 1–24 letters or digits (with inner spaces, dashes, apostrophes or ampersands); `emoji` is a single emoji of at most 16 code points ([ADR 0012](adr/0012-place-details.md)). `travel_date` only mirrors the start of the latest visit for the previous release ([below](#places-and-visits)). |
| `visits` | One stay at a place: `start_date` required, `end_date` optional and never before the start, `ongoing` true for a stay still going on (the API refuses it with an end date), `notes` up to 2,000, `photo_url` an HTTP(S) URL up to 2,048. At most 500 per place when created with it or imported. |
| `ledger_settings` | One row per traveler once they save: `day_rule`, and JSON arrays `rules` (at most 20 stay rules and thresholds, each with an id, name, 1–80 three-letter country codes, day counts and a warning margin) and `planned` (at most 30 stays with a country and first and last day). Validated in `validation.js`. |
| `visit_changes` | Append-only history of visit dates written by triggers: old and new `start_date`, `end_date` and `ongoing` of each added, changed or removed visit, with the place name and time. Kept after the visit or place is removed. |
| `trips` | `title` 1–120 and `destination` 1–160 characters, optional `start_date`. `plan` is a JSON array of 1–30 days, each with `morning`, `afternoon` and `evening` text of up to 500 characters. |
| `sessions` | Server-side sessions for `connect-pg-simple`; expired rows are pruned every 15 minutes. |
| `rate_limits` | Unlogged rate-limit counters per limiter and client IP, shared by replicas; expired rows are swept every 10 minutes. |
| `geocoder_throttle` | One row with the earliest start time of the next Nominatim request. |
| `schema_migrations` | Applied migration versions. |

All timestamps are `created_at`/`updated_at` (`timestamptz`). Deleting a user cascades to their
markers, their visits, trips, ledger settings and date history; deleting a place removes its
visits and records them as removed in the history.

## Places And Visits

A place is saved once; each visit records one stay there
([ADR 0009](adr/0009-places-and-visits.md)). Visit dates are plain local calendar dates at the
destination, with no time or time zone, inclusive at both ends, and are returned as
`YYYY-MM-DD` strings. A visit without an end date is either still going on (`ongoing`) or its
end was not recorded. The [day ledger](#day-ledger) counts days per country from these spans.

Migration 004 is the expand step of an expand-and-contract change: it backfilled one visit for
every place that had a `travel_date`, and keeps that column as a mirror of the latest visit with
triggers, so the previous release can keep reading and writing it. A date written the old way
only ever adds a visit. A later release drops the mirror and the triggers
([roadmap](../TODO.md)).

Migration 006 added `rating`, `tags` and `emoji` to `markers` with defaults; the previous
release never writes them, and the API changes them only when a request sends them, so its
updates keep them ([ADR 0012](adr/0012-place-details.md)).

## Day Ledger

Counting runs in the browser (`public/js/days.js`, [ADR 0010](adr/0010-day-ledger.md)):

| Rule | How a visit counts |
|---|---|
| Any part of a day (`presence`) | Every day from the first to the last day, both included |
| Midnight rule (`midnight`) | Every night: the first day up to the day before the last; a same-day visit counts none |
| Still going on (`ongoing`) | Through today under either rule, or the first day if it starts later |
| End not recorded | The first day only, under either rule, flagged in the tab and the report |

A city counts for its country, and a day counts once per country (or group of countries)
however many places hold it. Days before 1900 or more than ten years ahead are ignored. Schengen
90/180 always counts any part of a day; the traveler's day rule applies to day counters, tax
thresholds and evidence reports, and each custom stay rule has its own.

Migration 005 added `visits.ongoing` (default false, so the previous release keeps working),
`ledger_settings` and `visit_changes` with its triggers. The history records writes of the
previous release too, skips edits to notes and photo links, and starts with that migration.

## Migrations

Files named `NNN_description.sql` run in order at startup, each in its own transaction, under a
PostgreSQL advisory lock so replicas never race. `npm run migrate` applies them without starting
the server. Migrations are forward-only: add a new file, never edit an applied one, and keep
changes compatible with the previous release while both may run during a rollout.

## Map Data

`public/data/` holds read-only reference data built by `scripts/build-map-data.js` from
[Natural Earth](https://www.naturalearthdata.com) (public domain) and
[GeoNames](https://www.geonames.org) `cities500` (CC BY 4.0, credited on the map):

| File | Contents |
|---|---|
| `countries.geojson` | 1:50m country borders simplified to 0.02°, with name, aliases, continent, population and label placement |
| `cities.json` | The base list loaded with the page: about 4,900 places shown by zoom 6, as objects with name, country, capital flag, population, `minZoom` and coordinates |
| `cities/index.json`, `cities/<tile>.json` | About 220,000 smaller places in region tiles of up to 4,000, as rows `[name, countryId, capital, population, minZoom, lat, lng]` |

Every GeoNames place of 500+ people is included, except city districts, historical and
abandoned places. `minZoom` is the first half zoom step at which the place's dot and name fit
beside the places shown before it, ranked by capitals, Natural Earth's curated label zooms and
population; places that never fit get `11.5` and show as dots at the deepest zoom.

To rebuild, see [development](development.md#rebuilding-map-data).

## Import And Export

Export and import use the marker fields `id, lat, lng, type, name, category, photoUrl, notes,
travelDate, rating, tags, emoji`, where `travelDate` is the start of the latest visit and
`tags` is a list in JSON and one cell separated by semicolons in CSV:

- **JSON** nests each place's `visits` (`startDate, endDate, notes, photoUrl, ongoing`), newest
  first.
- **CSV** has one row per visit, adding `visitStartDate, visitEndDate, visitNotes,
  visitPhotoUrl, visitOngoing` (`yes` for a stay still going on); a place without visits has one
  row with those columns empty.

On import, rows of the same place (same type, kind and name) are joined and repeated visits
dropped. Files from before visits existed still import: their `travelDate` becomes the place's
only visit. Files without ratings, tags or emoji import with none. A row with an invalid visit is skipped. The Places tab drops places that duplicate
an existing one, then `POST /api/markers/import` stores up to 1,000 places with their visits in
one transaction and reports the invalid rows it skipped.

## Privacy

Data is private to its owner. A public profile exposes username, coordinates, type, name,
category, latest travel date and visit dates of each place, never the notes or photo links of
places or visits, ratings, tags or emoji, whether a stay is still going on, ledger settings or date history
([security](security.md#privacy)). Deleting an account removes the user, their
places, visits, ledger settings, date history, trips and sessions at once.
