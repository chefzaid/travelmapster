# ADR 0013: Hide Single Places From A Public Map

- Status: Accepted
- Date: 2026-10-23

## Context

A public map was all or nothing: making it public shared every saved place with its visit
dates. Some trips are sensitive (a clinic abroad, a family matter, a client visit under
embargo), and travelers should not have to keep a whole map private, or delete the place and
lose its days in the ledger, to keep one trip to themselves.

## Decision

- **A flag per place.** `markers.hide_from_public` (migration 007, default `false`, so every
  place stays shared as before) is set from the place's edit form and exposed as
  `hideFromPublic` in the API, imports and exports. It is only about the public map: the
  owner's map, passport and day ledger still count the place.
- **Filtered in SQL.** `GET /api/public/:username` reads places through a repository query
  that leaves hidden places out (`NOT hide_from_public`), so neither a hidden place nor its
  visits ever reach the response; the route keeps its own field whitelist on top. The flag
  itself is not part of the public response.
- **No inference.** A hidden place is simply absent. Hiding a country does not hide cities
  saved in it, which still color it in on the public map; travelers hide those too. The form
  says what hiding does.
- **Rollout.** The column is additive and the previous release's updates leave it alone, as for
  [ADR 0012](0012-place-details.md). The previous release does not know the flag, though: while
  one of its replicas serves public maps, during a rollout or after a rollback, it lists hidden
  places again. A rollout is short; a rollback below this release should be avoided, or done
  with public maps paused, once travelers have hidden places.

## Consequences

- Public maps can be shared without exposing sensitive trips, and nothing about hidden places
  is inferable from the response.
- Integration tests prove hidden places, and their visits, never appear on a public map, and a
  browser journey checks a visitor's view.
- Rolling back past this release has a privacy cost that operators must weigh.
