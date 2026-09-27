# ADR 0007: Draw Towns On A Canvas Layer

- Status: Accepted
- Date: 2026-09-27

## Context

The map shows every town of 500+ people, hundreds at a time on screen. As Leaflet markers, each
town was a DOM element on its own compositing layer, so zooming and panning stuttered as more
towns appeared, and names popped in after each zoom.

## Decision

`public/js/city-layer.js` draws town dots and names on one canvas in the cities pane. `map.js`
still decides which towns fit and on which side the name goes, then redraws once the map has
settled. During zoom animations the last drawing is scaled the way Leaflet scales its own layers.
Clicks and hovers are resolved by hit-testing a spatial grid of the drawn boxes; a town wins
over the country beneath it. Country labels and the traveler's own pins stay DOM markers.

## Consequences

- Frame times stay steady with several times more towns on screen than before.
- Town names are pixels, not text: they are not selectable and screen readers do not see them.
  Search remains the accessible way to reach any town, and its results open the same card.
- Drawing colours come from the CSS tokens and are re-read when the colour scheme changes.
