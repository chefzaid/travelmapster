# ADR 0025: Imports From Photos And Location History Stay In The Browser

- Status: Accepted
- Date: 2026-10-26

## Context

Most travelers already have a record of where they have been: the GPS position and date in
their photos, and their phone's location history (Google Takeout's Semantic Location History,
or the Timeline file Google Maps exports on Android and iOS since the history moved to the
phone). Both are exact, minute-by-minute records of a person's movements, far more than a
travel map needs. Places are stored at town or country level, never a precise position.

## Decision

- **Read in the browser.** Photos and location history files are read by the page and never
  uploaded. From a photo only its EXIF position and original date are read (JPEG, and HEIC as
  iPhones save them), from the first bytes of the file; from location history only the stays
  at places, not the movements between them. Google's raw location records (`Records.json`)
  are skipped: they are too large to read in a page and add nothing a stay does not have.
- **Reduced to towns.** Each position becomes the town it is in or near, from the bundled town
  data: the largest town within 10 km (a district of Paris is Paris), else the nearest within
  30 km, else the country. The place is saved at the town's coordinates or the country's label.
- **Days become visits.** A photo is a day there; a stay in the history covers its days, in the
  local time of the place (the timestamp's offset, or the longitude's time zone when the file
  has UTC only). Days at the same place with gaps of up to two days make one visit; at most the
  latest 500 visits per place are kept.
- **Every visit is reviewed.** The preview lists each visit by place, ticked, and nothing is
  saved until the traveler confirms. Places already on the map only get the visits they lack,
  as for the other imports.

## Consequences

- No new API, storage or dependency: the visits go through the existing place import and
  visit routes, with their validation and limits.
- The nearest-town rule can name the neighbouring town for a remote spot, and a long stay at
  home becomes long visits; the review is where the traveler fixes both.
- Background location on the phone is a separate decision for the mobile apps (see the roadmap).
