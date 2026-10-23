# ADR 0015: Choose The Country List To Count Against

- Status: Accepted
- Date: 2026-10-23

## Context

The passport counted every territory the map draws: 241 shapes from Natural Earth's 1:50m
admin-0 countries without Antarctica, including dependencies such as Greenland or Puerto Rico and
disputed or partially recognized territories such as Kosovo or Northern Cyprus. Travelers compare
their counts with friends and other apps, and most of them count "countries" as the members of
the United Nations; travel clubs keep their own, longer lists. "How many countries have you
been to?" has no single answer, so the list has to be a choice, with a rule that is written
down and does not take sides in sovereignty disputes.

## Decision

### Lists

The traveler picks the list in Settings; it is stored on the account (`users.country_list`,
migration 010, `PATCH /api/profile` with `countryList`) and applied in the browser by
`public/js/lists.js`:

- **`all`: every territory on the map** (241), the default, which keeps every existing count
  as it was.
- **`un`: UN members and observer states** (195): the 193 member states and the two
  non-member observer states, the Holy See (Vatican City) and Palestine. Membership is a fact
  recorded by the UN, so the list needs no judgment from TravelMapster. South Sudan is `SDS` in
  Natural Earth's codes.

The list drives every count: countries been to, lived in, transit only and wishlist, the share
of the world (or "of UN countries"), continent totals and progress, ranks, badges, stamps and
the legend numbers. It never changes the map, which colors in every territory been to, nor the
day ledger, which counts days per territory the map draws. A public map uses its owner's list,
so visitors see the same numbers.

### The rule for disputed and partially recognized territories

1. **A place belongs to the territory the map draws it in.** The map uses Natural Earth's
   default admin-0 countries, which follow who controls an area on the ground (de facto), and
   TravelMapster never moves a place, or a territory, to another country under any list.
2. **A list counts a territory only if the list names it.** Territories that are not on it
   are still colored in, listed in Places and counted in the day ledger, and the passport names
   them ("Also been to, not on the UN countries list") without a stamp.
3. **A traveler who also went to the member country marks it too.** A visit to Hong Kong does
   not count as China, nor one to Pristina as Serbia: TravelMapster does not decide which
   country a territory belongs to.

How the map data represents the territories travelers ask about:

| Territory | On the map | UN list |
|---|---|---|
| Kosovo | Drawn on its own (`KOS`), apart from Serbia | Not counted: not a UN member |
| Taiwan | Drawn on its own (`TWN`), apart from China | Not counted: not a UN member |
| Western Sahara | Drawn on its own (`SAH`), apart from Morocco | Not counted: a non-self-governing territory, not a member |
| Palestine | Drawn on its own (`PSX`, the West Bank and Gaza) | Counted: observer state |
| Vatican City | Drawn on its own (`VAT`) | Counted: the Holy See is an observer state |
| Northern Cyprus | Drawn on its own (`CYN`), apart from Cyprus | Not counted: not a UN member |
| Somaliland | Drawn on its own (`SOL`), apart from Somalia | Not counted: not a UN member |
| Siachen Glacier | Drawn on its own (`KAS`), an area India and Pakistan both claim | Not counted |
| Dependencies and special areas (Greenland, Faroe Islands, Puerto Rico, Hong Kong, Macao, Åland and others) | Drawn on their own | Not counted |

Cyprus, Serbia, Morocco, Somalia, China, India and Pakistan count on the UN list as the
territories the map draws for them. A border change in the map data changes counts only through
a data rebuild, which is reviewed like code ([ADR 0005](0005-bundled-map-data.md)).

### Travel-club lists

Travel-club lists such as the Travelers' Century Club's are not shipped. Their lists are
copyrighted, and they split countries into parts the map does not draw (states, islands and
regions such as Alaska or the Canary Islands), so a fair count needs both a licence and finer
map data. The roadmap keeps that as remaining work.

### Rollout

Migration 010 adds `users.country_list` with the default `all` and a check. The previous release
never reads or writes it, so its passport counts every territory, as the default does; a tab of
the previous release keeps working with the new API, which only adds `countryList` to responses.
A shared map served by a previous-release replica has no `countryList` and counts every
territory.

## Consequences

- Travelers can compare UN counts with other apps, or keep counting every territory, and the
  counting never depends on TravelMapster's view of a dispute.
- The rule is mechanical, and tests check it against the bundled map data: every UN member and
  observer is on the map, and the disputed territories above are drawn on their own and left
  out of the UN list.
- Someone who visited only Hong Kong or Pristina sees them colored in but not counted on the
  UN list until they also mark China or Serbia, which the passport makes visible.
