# ADR 0030: Pre-Trip Checklists From The Organization

- Status: Accepted
- Date: 2026-10-26

## Context

Employers sending staff abroad have formalities to complete before each trip, depending on the
destination: an A1 certificate for social security within the EU, a posted-worker declaration,
a visa or a travel risk briefing. [ADR 0029](0029-organizations-and-business-days.md) gave
organizations rules for days already spent; they now want to remind travelers of what to do
before going. Three questions: which trips a checklist applies to, where the traveler ticks it
off, and how reminders reach them without email.

## Decision

- **Business trips.** A trip's owner can say it is a business trip for one of their
  organizations, like a visit ([ADR 0029](0029-organizations-and-business-days.md)); personal by
  default. Only the owner sets it; editors of a shared trip leave it as it is. Recording a
  business trip as visits makes business visits for that organization. Leaving the organization,
  or its deletion, turns the trip personal again.
- **The checklist.** Admins of an organization keep up to 50 items, each with a task (up to 80
  characters, such as "A1 certificate"), the countries it is for (or "Schengen", as in the
  ledger's rules), how many days before the trip it is due (0–365) and an optional link to the
  official page. Managers see it; travelers see the items that concern their trips.
- **Ticking it off.** The trip editor lists the items for the trip's countries, each with its due
  date when the trip is dated, and adds them to the trip's packing list in one click, where they
  are ticked like any other item. A done item is one packed on the list under the same name; no
  new storage per trip is needed, and the list already syncs with whoever plans the trip too.
- **Reminders.** In the app: an upcoming business trip with items not done shows how many in the
  Trips tab, and the trip editor marks overdue ones. Email waits for a sender.
- **Privacy.** The organization never sees a traveler's trips or their checklists; it only
  writes the list.

## Consequences

- Migration `020_trip_checklists.sql` adds `org_rules.checklist` and `trips.organization_id`
  (`ON DELETE SET NULL`); additive, and the previous release never reads them
  ([ADR 0004](0004-postgres-and-migrations.md)). A trip saved by the previous release keeps its
  organization, as an update leaves out what it does not send.
- Checking that an item is done by its name means renaming a packed item un-does it; the editor
  adds it again on request.
