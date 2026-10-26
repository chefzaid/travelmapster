# ADR 0018: Product Metrics Without Third-Party Analytics

- Status: Accepted
- Date: 2026-10-26

## Context

Growth work needs to know whether people sign up, save a first place, keep going to ten, use the
day ledger and come back ([roadmap](../../TODO.md#market-and-growth-added-2026-10-23)). The
product principles rule out ads and third-party trackers ([ADR 0017](0017-product-principles.md)),
and the platform already scrapes the app's Prometheus endpoint, which no visitor can reach.

## Decision

- **Funnel counters.** `travelmapster_funnel_total{step}` counts travelers reaching each step:
  `sign_up`, `first_place` and `ten_places` (when a traveler's number of places first crosses
  one or ten through any route that adds places), and `first_ledger_use` (their first saved
  ledger settings). A paid step comes with paid plans. Counters live in each process, so a
  query sums them over replicas; a traveler who empties their map and fills it again counts
  again, which is rare enough for trends.
- **Activity.** `users.last_seen_on` holds the last day an account was used: a date only,
  written by the first authenticated request of each day (migration 012). The metrics scrape
  counts accounts in total, active in the last 1, 7 and 30 days, and returning (older than 30
  days and active in the last 7) as `travelmapster_users{activity}`. Every replica reports the
  same database-wide numbers, so dashboards take the maximum.
- Nothing in a metric identifies a person: no usernames, ids, places or dates per user. No
  script, cookie or request goes to an analytics service.

## Consequences

- One extra write per account per day, at its first request.
- `last_seen_on` is personal data: it is part of the account archive and deleted with the
  account.
- Cohort retention beyond these windows needs a dashboard query over the counters, or a new
  aggregate, not per-user tracking.
