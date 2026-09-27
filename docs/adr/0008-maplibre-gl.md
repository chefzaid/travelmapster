# ADR 0008: Render The Map With MapLibre GL

- Status: Accepted
- Date: 2026-09-27
- Supersedes: [ADR 0007](0007-canvas-towns.md)

## Context

Leaflet zooms in steps: it stretches the current picture for a quarter second, then redraws
borders and places. Even with towns on a canvas ([ADR 0007](0007-canvas-towns.md)), zooming looked
like a page loading rather than the continuous zoom of a modern web map. A prototype with
MapLibre GL, drawing on the GPU, was clearly smoother.

## Decision

`public/js/map.js` renders the map with [MapLibre GL JS](https://maplibre.org) 6, vendored in
`public/vendor/maplibre/` (BSD-3-Clause). The cartoon style is built in code from the CSS tokens,
so it follows the light and dark themes:

- Countries are a GeoJSON source with feature states (`visited`, `wishlist`, `cityOnly`,
  `hover`, `pulse`) that drive fill and outline expressions.
- Towns are a symbol layer that shows each place from its `minZoom`, with a sort key for
  priority and variable anchors for names; MapLibre handles collisions and fading. A dot-only
  layer shows every remaining place at the deepest zoom.
- Text is drawn in the browser from the bundled Nunito and Fredoka files through the style's
  `font-faces`, so no glyph server exists; the name sets the weight ("Nunito Extra Bold").
- MapLibre's worker loads as a same-origin module, so the Content Security Policy is unchanged.
- Pins stay HTML markers, and cards are MapLibre popups holding the app's card elements.

The app and its data keep Leaflet-scale zoom levels; MapLibre's are one lower for the same scale
(512 px tiles), and `map.js` converts at its boundary.

## Consequences

- Zooming and panning are continuous and GPU-accelerated; names fade instead of popping.
- The page needs WebGL, available in every current browser. MapLibre adds about 1.1 MB of script
  (about 300 KB compressed), cached for a year with the rest of the assets.
- Town and country names are drawn pixels: screen readers do not see them. Search remains the
  accessible way to reach any place, and its results open the same card.
- MapLibre's collision boxes differ slightly from the build's grading, so a few graded towns may
  wait for the next zoom step.
