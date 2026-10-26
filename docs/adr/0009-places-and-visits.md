# ADR 0009: Split Saved Places Into Places And Dated Visits

- Status: Accepted
- Date: 2026-10-23

## Context

Each saved place (`markers`) had one travel date, one note and one photo link, so a city seen
five times looked like a single trip. The planned day ledger (days per country, Schengen 90/180,
tax-residency thresholds) needs every stay with its own dates. Migrations must stay compatible
with the previous release while both run during a rollout or rollback
([ADR 0004](0004-postgres-and-migrations.md)), and browser tabs opened before a release keep
calling the API with the old fields until they reload.

## Decision

- **Model.** `markers` stays the places table. A new `visits` table holds any number of visits
  per place: `start_date` (required), optional `end_date` (on or after the start), `notes` and a
  `photo_url`. A visit belongs to a place, so it is scoped to the user through the place and
  removed with it, and with the account. The place keeps its own notes and photo link as a
  description of the place.
- **Dates.** Visits use PostgreSQL `DATE`: plain local calendar dates at the destination, with no
  time and no time zone, inclusive at both ends. A missing end date means the end was not
  recorded; the day ledger will choose how such visits count.
- **Expand step (migration 004).** It creates `visits` and backfills one visit for every place
  with a `travel_date`. The column stays and mirrors the start of the latest visit. Triggers keep
  both sides in step, so the previous release and old browser tabs work unchanged:
  - Adding, changing or removing a visit updates the mirror.
  - A travel date written the old way only ever adds a visit: a new place with a date gets that
    visit, and a changed date adds one unless a visit already starts that day. The mirror always
    shows the latest visit again, so clearing the date the old way loses nothing.
  - Triggers skip changes made by other triggers (`pg_trigger_depth()`), so they never loop.
- **API.** `GET /api/markers` embeds each place's visits, newest first, and keeps `travelDate`
  as the start of the latest visit. Creating and importing a place accept a `visits` array,
  which wins over `travelDate`. Updating a place leaves visits alone unless an old client sends
  `travelDate`. Visits have their own routes: `GET` and `POST /api/markers/:id/visits`,
  `PATCH` and `DELETE /api/visits/:id`. Public maps share visit dates only.
- **Contract step (a later release).** Once no running release or supported file format relies
  on it, drop the triggers and `markers.travel_date`, and keep `travelDate` only as an import
  field that becomes a visit. It takes two releases, since the previous release writes the
  column itself: from 1.10.0 the app never reads or writes it (a `travelDate` sent by an old tab
  or a file becomes a visit in the app, with the triggers' rules), and the release after it
  drops the triggers and the column. An integration test drops them and runs every place route.

## Consequences

- A rolling release, a rollback and old tabs all keep working; anything they write becomes a
  visit instead of being lost.
- Some logic lives in PL/pgSQL triggers until the contract step; it is covered by integration
  tests that write the columns the way the previous release does.
- An old client that changes a place's date adds a visit rather than moving one, which the
  traveler can tidy up in the new card.
- Every visit-aware feature (day ledger, year slider, journey lines, evidence reports) reads
  `visits`; `travelDate` is only a convenience for older readers.
