# ADR 0029: Organizations, Business Visits And Employer Rules

- Status: Accepted
- Date: 2026-10-26

## Context

[ADR 0022](0022-teams.md) decided how the Teams tier works: organizations with travelers,
managers and admins, business visits marked by the traveler, and employers who see business-day
counts and the status of their rules, never places, notes or personal trips. Building it now
needs three decisions it left open: how people join without email (no sender exists yet, see
the roadmap), who may create an organization before paid plans exist, and how the server counts
days with the same rules as the browser.

## Decision

- **Organizations.** Any signed-in account can create one and becomes its admin; until plans
  and entitlements exist ([roadmap](../../TODO.md#needs-input)) this costs nothing. An account
  belongs to at most 10. Admins rename or delete it, change roles and remove members; an
  organization always keeps an admin. Anyone can leave, except its last admin.
- **Stronger sign-in to run one.** Creating an organization, and anything a manager or admin
  does in it, needs a passkey or two-step sign-in on the account, as
  [ADR 0027](0027-passkeys-and-two-step-sign-in.md) planned; the app offers to set one up.
  Travelers join and leave without one.
- **Invitations are links.** An admin makes a single-use invitation for a role; the app shows a
  link (`/#join=<token>`) valid for seven days, which the admin passes on as they like. Only a
  SHA-256 hash of the token is stored. Opening the link signs in or up first, then asks the
  traveler to confirm joining; nothing happens without that. Admins see and revoke pending
  invitations.
- **Business visits.** A visit gets a `purpose`, `personal` by default or `business` for one of
  the traveler's organizations, set only by the traveler on the visit form. Places created with
  visits and imports always make personal visits.
- **Employer rules.** Admins set up to 20 stay rules and thresholds, in the ledger's own format
  and editor ([ADR 0010](0010-day-ledger.md)). Travelers see them in their Ledger tab, counted
  on their business visits for that organization, beside their own rules.
- **The report.** Managers and admins see, for each member and a period (the calendar year by
  default), business days per country and each rule's status, and download it as CSV for an
  adviser. The server counts with `public/js/days.js` and finds countries with
  `public/js/geo.js` over the bundled borders, loaded as ES modules, so the report and the
  traveler's Ledger tab agree. Only business visits for that organization are read; place
  names, notes, cities and dates never leave the server.
- **Audit log.** Each report writes one entry per member it shows (who looked, when); members
  read the entries about themselves from the Organizations dialog and in their data download.
  The report is loaded only when asked for, not each time the dialog opens.

## Consequences

- Migration `019_organizations.sql` adds `organizations`, `memberships`, `invitations`,
  `org_rules` and `audit_log`, and `visits.purpose` and `visits.organization_id`; additive, and
  the previous release never reads them ([ADR 0004](0004-postgres-and-migrations.md)). Deleting
  an organization turns its business visits back into personal ones.
- Alerts reach the traveler in the Ledger tab and managers in the report; email alerts wait for
  a sender, single sign-on and billing for their own decisions.
- Pre-trip checklists build on the same organizations and rules.
