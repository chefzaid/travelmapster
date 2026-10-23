# ADR 0012: Optional Details On Saved Places

- Status: Accepted
- Date: 2026-10-23

## Context

A saved place had a status, notes and a photo link. Travelers want to say how much they liked a
place, group places by what they did there (food, hiking, family, work) and give a pin some
personality, then find those places again in the list and on the map. Wishlist places also
need a priority and the months that suit a trip, to answer "where should I go next?". These
details are
personal opinions, so they need a clear sharing rule, and the change must keep the
previous-release rollout rule of [ADR 0004](0004-postgres-and-migrations.md): during a rollout
or a rollback the previous release and browser tabs opened before the release keep reading and
writing places without knowing the new fields.

## Decision

- **Columns on `markers`.** `rating` (1 to 5 stars, or none), `tags` (a `TEXT[]` of up to 8
  tags) and `emoji` (one emoji, or none) are added by migration 006 with defaults, so rows
  written by the previous release are valid and look like places without details. Migration
  008 adds `priority` (`high`, `medium` or `low`, or none) and `best_months` (a `SMALLINT[]` of
  month numbers, stored sorted and unique) the same way.
- **Partial updates.** `PATCH /api/markers/:id` still replaces the core fields, but writes a
  detail only when the request sends it: an older client that does not know the fields keeps
  what is stored, and `null` or an empty value clears a field. Creating and importing take the
  details with the place, so undoing a removal brings them back.
- **Tags.** Six suggested tags (food, hiking, family, work, beach, culture) and free tags of the
  traveler's own. Tags are lowercased with single spaces, so "Street  Food" and "street food"
  are one tag, and hold 1 to 24 letters or digits in any script with inner spaces, dashes,
  apostrophes or ampersands. Commas and semicolons are never part of a tag, so CSV files hold a
  place's tags in one cell separated by semicolons.
- **Emoji.** The server accepts exactly one grapheme made only of emoji characters (flags,
  keycaps, skin tones and joined sequences included), at most 16 code points, using
  `Intl.Segmenter` and Unicode properties; no emoji list is bundled. The emoji replaces the
  check or heart on a city's pin, whose color still shows the status, and stands in for the
  flag in the places list. Country labels stay plain text, to keep the map uncluttered and
  because emoji do not render reliably as map glyphs.
- **When to go.** The places list can order wishlist places by the next of their best months,
  counted from the traveler's current month (this month first, a month just gone last), then
  by priority and name; places without months come last. Months rather than dates keep the
  plan about seasons, and several months cover seasons that span the new year.
- **Filters.** A tag and a minimum rating filter the Places tab and the map together (pins and
  country colors), and the legend shows the active filter with a button to clear it. Counts in
  the legend and the passport still count every place.
- **Privacy.** Ratings, tags, emoji and wishlist plans are never part of a public map, like notes and photo
  links: a public map shows where and when the traveler went, not what they think of it, and a
  tag such as "work" or "family" can say more than the traveler meant to share.

## Consequences

- Older releases and tabs keep working and never erase details they do not know about.
- Validation lives in both `src/validation.js` and `public/js/details.js`, with the schema
  enforcing the limits as a last line of defense, like the other place fields.
- Exports gain `rating`, `tags`, `emoji`, `priority` and `bestMonths`; files without them
  still import with no details.
