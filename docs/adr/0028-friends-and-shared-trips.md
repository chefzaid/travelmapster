# ADR 0028: Friends Follow Public Maps, And Trips Are Planned Together

- Status: Accepted
- Date: 2026-10-26

## Context

Travel is social: people compare how much of the world they have seen and plan trips with the
people they travel with. The app shares a map only as a public, read-only page
([ADR 0011](0011-public-pages.md)), and a trip belongs to one account. Anything social must keep
the privacy promise: nothing becomes visible to others unless its owner makes it so, and no
one is notified or tracked.

## Decision

- **Following is reading public maps.** A traveler follows a map by its owner's name, from the
  shared map page or the Passport tab. Only public maps can be followed, and a follow shows
  nothing the public map does not ([ADR 0013](0013-hidden-places.md),
  [ADR 0014](0014-home-lived-and-transit.md)). A follow is one-way and silent: the owner is not
  told, sees no list of followers, and making the map private hides it from everyone who
  follows it (the follow stays, shown as private, until the follower drops it). At most 200.
- **Comparing countries.** For a followed map, the Passport tab shows the countries both have
  been to, only the traveler, and only the friend, counted on the traveler's country list.
  It is worked out in the browser from the public map; the server keeps no comparison.
- **Planning together.** A trip's owner shares it with other accounts by username, each with a
  role: `edit` (change the days, stops, packing list and budget) or `view` (read, copy, print,
  export to a calendar). Members see it in their Trips tab marked with its owner; they can plan
  it in their own ledger or record it as their own visits, and leave it at any time. Only the
  owner deletes the trip or changes who it is shared with; at most 20 members.
- **Edits do not overwrite each other.** Saving a trip sends the `updatedAt` it was edited
  from; when someone else saved in between, the save is refused (409) with the newer trip, and
  the editor reloads it. There is no live co-editing.

## Consequences

- Migration `018_friends.sql` adds `follows` and `trip_members`, each removed with either
  account or the trip; additive, as the previous release never reads them
  ([ADR 0004](0004-postgres-and-migrations.md)). The previous release, which sends no
  `updatedAt`, still saves trips as before.
- Sharing a trip reveals the owner's username and the trip to its members, and adding a member
  tells the owner that a username exists, as sign-up already does.
- The account archive holds the traveler's own trips and the names they follow, never another
  account's trips.
- Notifications, friend requests and activity feeds are left out on purpose.
