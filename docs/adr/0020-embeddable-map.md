# ADR 0020: An Embeddable Public Map

- Status: Accepted
- Date: 2026-10-26

## Context

Travelers with a blog or a personal site want to show their map there, read-only. Every page
forbids framing today (`frame-ancestors 'none'` and `X-Frame-Options`) against clickjacking, and
a shared map already exists at `/?u=<username>` with only what the owner made public
([ADR 0011](0011-public-pages.md), [ADR 0013](0013-hidden-places.md)).

## Decision

- **A page of its own.** `/embed/<username>` serves `public/embed.html`: the map, a small card
  with the owner's name, their countries and cities, and a link that opens the full map on
  TravelMapster in a new tab. Clicks on the map do nothing; there is no account, form, button
  that changes data, cookie it relies on, or note, photo, rating, tag or hidden place.
- **Framing for that page only.** Its route keeps the rest of the CSP and changes only
  `frame-ancestors` to `*`, and drops `X-Frame-Options`. Every other page still refuses to be
  framed. The page is sent with `X-Robots-Tag: noindex`, like shared maps.
- **Data.** It reads `GET /api/public/<username>`, so it shows exactly the public map, and a
  private or missing map shows a short message, never data.
- **Sharing.** The account menu copies an `<iframe>` snippet while the map is public.

## Consequences

- No new data is exposed: the page is a second view of the public API.
- Clickjacking stays out of reach: the framed page has nothing to click that acts for anyone.
- Turning the map private empties every embed at once.
