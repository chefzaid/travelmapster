# ADR 0023: Link Previews For Shared Maps, And Indexing Only By Choice

- Status: Accepted
- Date: 2026-10-26

## Context

A shared map (`/?u=<name>`) is the app's page with the map drawn in the browser. Posted in a
chat or on social media, its link showed the site's generic title and no picture, since link
previews come from the page's tags and crawlers do not run scripts. Shared maps were also sent
with `X-Robots-Tag: noindex` and left out of the sitemap until their owners could opt in
([ADR 0011](0011-public-pages.md)). A travel map that previews well is the product's best
advertisement, but being listed in search results is the owner's choice, not ours.

## Decision

- **Per-map tags.** For a public map the server sends the app page with the map's own title
  ("<name>'s travel map"), a description with the counts the public map already shows (countries
  been to, share of the world, cities) and Open Graph and Twitter card tags. Private and missing
  maps get the generic page, so the two still look the same to a caller.
- **Preview picture.** `/og/<name>.png` is a 1200 × 630 PNG of the world with the countries
  colored as on the public map, in the poster's cartoon style. It is drawn in the process
  without a graphics library: a scanline fill of the bundled country borders at twice the size,
  outlines where neighbouring pixels differ, averaged down, encoded with `node:zlib`. No
  dependency, no fonts and no native build in the image; the counts are in the tags, not the
  picture. The browser's own modules (`geo.js`, `poster.js`) count and color it, so the picture
  matches the map. The country layout is drawn once per process (about 0.1 s); a picture takes
  about 50 ms, is cached in memory by its colors (64 pictures), sent with an `ETag` and
  `Cache-Control: public, max-age=3600`, and limited to `RATE_LIMIT_PREVIEW` per client IP.
- **Only what the public map shows.** The counts and colors come from the same query as the
  public map: hidden places are left out, and the home country is never colored or counted.
- **Indexing by choice.** A new setting, off by default, lets search engines list a public map:
  the page then has no `noindex` header and a canonical link, and the sitemap lists it. Making
  the map private takes it out at once, whatever the setting.
- **Call to action.** The shared map invites visitors to make their own, as before, with a line
  saying what the app does.

## Consequences

- Migration `015_public_indexing.sql` adds `users.public_indexing` (default false), additive and
  compatible with the previous release ([ADR 0004](0004-postgres-and-migrations.md)).
- The page route for `/?u=<name>` reads the database; the landing page without `u` does not.
- Link previews can show a stale picture for up to an hour after a change, and social networks
  cache their own copy longer.
- A picture with text (the name and counts) would need fonts in the image, or drawing them as
  shapes; it can come later without changing the address.
