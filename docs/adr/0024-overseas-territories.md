# ADR 0024: Overseas Territories Outside The Schengen Area Are Territories Of Their Own

- Status: Accepted
- Date: 2026-10-26

## Context

The map drew some overseas parts of Schengen members inside the member's shape: French Guiana,
Guadeloupe, Martinique, Réunion and Mayotte within France, Svalbard within Norway and the
Caribbean Netherlands (Bonaire, Sint Eustatius and Saba) within the Netherlands. A day in
Cayenne therefore counted as a Schengen day, although these places are outside the area, which
the day ledger could only state as a known limit ([ADR 0010](0010-day-ledger.md)). Towns in them
were missing too: GeoNames files them under their own country codes (GF, RE, SJ, BQ…), which
matched no shape on the map.

## Decision

- **Split at build time.** `scripts/build-map-data.js` replaces those three members' shapes with
  Natural Earth's map subunits (`ne_50m_admin_0_map_subunits`, same scale): France keeps
  metropolitan France and Corsica, Norway keeps the mainland and Jan Mayen (both in the area),
  and the Netherlands keeps the European part. Each overseas part becomes a territory with its
  ISO code as map code: `GUF`, `GLP`, `MTQ`, `REU`, `MYT`, `SJM` and `BES`. Parts that are in the
  area, such as the Canary Islands, Madeira or the Azores, stay with their member.
- **The ledger follows the map.** Places resolve to the territory drawn around them, so days in
  these territories count for themselves and not in the Schengen 90/180 rule, whose member list
  is unchanged.
- **Counting.** On the full list each is a territory like any other (248 in all). On the UN list
  having been to one counts its member (`MEMBER_PARTS` in `public/js/lists.js`), since they are
  part of that state rather than separate countries, so a traveler who has been to Réunion only
  still counts France there, as before.
- **Countries only, for now.** The build gains `--countries-only`, which rebuilds the borders
  from the two Natural Earth files and leaves the cities as they are. Towns in the new
  territories appear with the next full rebuild, which needs GeoNames.

## Consequences

- Places already saved in these territories move to their territory on the next page load,
  with no migration: countries are never stored, they are found from the place's position.
- A rule or threshold that names France (for example the 183-day rule for French tax
  residency, where the overseas departments are part of France) no longer counts days in them;
  a traveler who needs both adds the territories to the rule's countries.
- A home country of France no longer covers Réunion; travelers living there choose Réunion.
