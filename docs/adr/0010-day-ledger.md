# ADR 0010: Count Travel Days In The Browser From Dated Visits

- Status: Accepted
- Date: 2026-10-23

## Context

Visits carry plain calendar dates ([ADR 0009](0009-places-and-visits.md)). Travelers want to know
how many days they spent in each country, how many Schengen days they have left, and when a
tax-residency threshold comes close, with evidence they can hand to an adviser. That needs
counting rules that are explicit, the same everywhere, and testable; a decision on visits whose
end is unknown; somewhere to keep the traveler's own rules; and a record of how visit dates
changed, so a report can show what was edited and when. The map itself stays simple
([product principles](../features.md#product-principles)): the ledger is a tab, not a map layer.

## Decision

### Counting

- **Pure module.** All counting lives in `public/js/days.js`, a pure ES module with no DOM or
  network access, unit and property tested in Node. The browser computes every number from the
  places and visits it already has; the server stores data but never counts. Evidence reports
  are built in the browser only when the traveler asks.
- **Dates.** Visit dates are local calendar dates at the destination, stored as PostgreSQL
  `DATE` and handled as day numbers since 1970-01-01, so no time zone can shift a day. No time
  zone is stored: without times of day it would change nothing. "Today" is the device's local
  date, which is where the traveler is.
- **Day rules**, chosen in the Ledger tab and saved with the account:
  - *Any part of a day* (`presence`, the default): every day from the first to the last day of a
    visit counts, both included. A day spent in two countries, such as a border crossing, counts
    in both.
  - *Midnight rule* (`midnight`): a day counts where the traveler is at midnight, so the last day
    of a visit does not count and a same-day visit counts none. On a journey where each stay
    starts on the day the previous one ends, every night counts in exactly one country.
  - The traveler's rule applies to day counters, tax thresholds and evidence reports. Schengen
    always counts any part of a day, as the Schengen Borders Code counts entry and exit days;
    each custom stay rule picks its own day rule.
- **Cities count for their country.** A visit to a city counts for the country the place lies in
  (the same lookup that colors the map). A day counts once per country however many places hold
  it, and once for a group of countries such as Schengen. Wishlist places count their visits too:
  a visit is a visit.
- **Open-ended visits are explicit.** A visit without an end date is either:
  - *still going on* (new `visits.ongoing` flag, "I'm still there"): it counts through today, or
    its first day if it starts later; thresholds also project it forward to tell when a limit
    would be reached if the traveler stays on;
  - *end not recorded* (no flag; every visit from before this release): it counts its first day
    only, under either rule, and the Ledger tab and the evidence report flag it so the traveler
    can add the last day. Counting it through today would turn every old one-date visit into
    years abroad.
  An end date always wins over the flag.
- **Bounds.** Days before 1900 and more than ten years ahead are ignored, which also bounds the
  work a mistyped date can cause.

### Rules

- **Schengen 90/180** is built in: at most 90 days in any 180-day window ending on the day being
  checked. Days left today are 90 minus the days in the window ending today; the longest stay
  from an entry day is the longest run of days that breaks no window, for that stay or for any
  later recorded day. Members as of 2026: Austria, Belgium, Bulgaria, Croatia, Czechia, Denmark,
  Estonia, Finland, France, Germany, Greece, Hungary, Iceland, Italy, Latvia, Liechtenstein,
  Lithuania, Luxembourg, Malta, Netherlands, Norway, Poland, Portugal, Romania, Slovakia,
  Slovenia, Spain, Sweden and Switzerland (Bulgaria and Romania fully since 1 January 2025).
  Monaco, San Marino and Vatican City are counted because they are reached only through the area
  with no border checks. Cyprus and Ireland (EU members outside the area), Andorra (border checks
  with France and Spain) and other countries are not. A known limit: overseas parts of members that
  the bundled map draws as part of the member, such as French Guiana within France or Svalbard
  within Norway, count as Schengen days although they lie outside the area.
- **Stay rules** of the traveler: "N days in any M-day window" for one country or a group counted
  together, with a day rule and a warning margin.
- **Thresholds**: the built-in 183 days in a calendar year, applied to each country on its own,
  and the traveler's own, for one country or a group: N days in a year starting on any MM-DD
  (`04-06` for the UK tax year; not February 29) or in a rolling window. A threshold warns when
  it is within its margin, or when recorded days or a stay still going on would reach it in the
  current period.
- **Planned stays** (country and dates) are added as hypothetical days to check each rule they
  touch; they are not visits.
- **Alerts** are in-app only: a badge on the Ledger tab, a list in the tab and a toast after
  sign-in. Email alerts wait for an email provider ([roadmap](../../TODO.md)).

### Storage

Migration 005 is additive, so the previous release keeps working during a rollout:

- `visits.ongoing BOOLEAN NOT NULL DEFAULT false`. The previous release never writes it; a visit
  it edits keeps the flag, and its end date, if any, wins.
- `ledger_settings`, one row per traveler: `day_rule`, and `rules` and `planned` as JSON arrays
  validated by the API (`PUT /api/ledger`, at most 20 rules and 30 planned stays). The rules are
  small, always read and written together, and only ever read by their owner, so a document per
  traveler is simpler than tables per rule kind.
- `visit_changes`, an append-only history of visit dates: who, which visit and place (with the
  place name at that time), `added`, `changed` or `removed`, old and new dates and flag, and when.
  Triggers on `visits` and `markers` write it, so every write is recorded, including those of
  the previous release and of the travel-date triggers of migration 004; edits to notes or photo
  links are not. The history has no foreign key to visits or places, so it outlives them, and is
  deleted with the account. It starts with this release: visits recorded earlier have no history
  before it. `GET /api/ledger/changes` returns the latest 5,000 entries, newest first.

## Consequences

- Every number on screen, in the CSV and on the printed report comes from one tested module, and
  the same data gives the same answer on any device.
- Nothing about where the traveler is today leaves the browser except the visits they save; the
  `ongoing` flag is never shared on public maps, as it would reveal where they are now.
- Counting on the device costs a fraction of a second even for thousands of visits; a
  server-side report (PDF rendering, scheduled email alerts) would need the module on the server
  too, which its plain ES module form allows.
- Evidence reports print to PDF through the browser, so no PDF library is needed.
- The `visit_changes` triggers add PL/pgSQL to maintain; they are covered by integration tests,
  including writes made the way the previous release makes them.
