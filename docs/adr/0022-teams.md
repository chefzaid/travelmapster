# ADR 0022: Teams, Where Employers See Business Days Only

- Status: Accepted
- Date: 2026-10-26

## Context

Companies must track how many days their employees spend working in each country, for tax and
social-security obligations (such as the 183-day rule and posted-worker rules in the EU). The
traveler already keeps an exact record of their days in the day ledger
([ADR 0010](0010-day-ledger.md)). The Teams tier gives the employer what it needs from that
record without turning the app into surveillance: the product principles promise that "an
employer sees business-travel day counts only, never personal trips"
([ADR 0017](0017-product-principles.md)).

## Decision

- **Organizations and membership.** An `organizations` table holds a name and its settings; a
  `memberships` table links a user to an organization with a role: `traveler`, `manager`
  (mobility or HR, who see the counts) or `admin` (who also manage members, rules and billing).
  A person joins only by accepting an invitation sent to them, and can leave at any time; an
  employer never creates or reads a traveler's own account. One account may belong to several
  organizations (a consultant), and keeps its personal map either way.
- **Business visits.** A visit gets an optional `purpose`: `personal` (the default) or
  `business`, with the organization it was for. Only the traveler sets it. Places, cities,
  notes, photo links, personal visits, the home country and the date history never leave the
  traveler's side.
- **What the employer sees.** For each traveler and country: business days in a period, and the
  status of the organization's thresholds and stay rules (on track, getting close, reached).
  Counted on the server from business visits only, with the same rules as the ledger:
  `public/js/days.js` stays the one implementation, loaded by the server as an ES module. No
  dates, places or trips are shown, except what a pre-trip checklist needs for a trip the
  traveler submits to it.
- **Rules per destination.** The organization configures thresholds and stay rules per country
  (as ledger rules); travelers see them in their Ledger tab beside their own, marked as their
  employer's, and both sides get alerts.
- **Records.** Reports for advisers are built on request from the same counts. Every manager or
  admin view of a traveler's counts is written to an audit log the traveler can read.
- **Billing and sign-on.** Teams is priced per traveler and needs organization single sign-on;
  both wait on owner decisions ([roadmap](../../TODO.md#needs-input)).

## Consequences

- Migrations add `organizations`, `memberships`, `invitations`, `org_rules` and `audit_log`, and
  `visits.purpose` and `visits.organization_id`, additive and compatible with the previous
  release ([ADR 0004](0004-postgres-and-migrations.md)).
- `days.js` must stay free of browser-only APIs, as it already is, since the server runs it too.
- New routes under `/api/orgs/…` join the OpenAPI description
  ([ADR 0019](0019-api-description-and-versioning.md)); every one checks membership and role,
  and integration tests cover a manager asking for a personal visit, a place or a non-member.
- The account archive and account deletion include memberships and the audit log; leaving an
  organization ends its access at once, and its past reports keep only counts.
