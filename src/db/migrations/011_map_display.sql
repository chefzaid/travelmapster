-- How a traveler's map is drawn (ADR 0016): the colour palette, and whether visitors of a
-- public map may see journey lines between visits. Additive with defaults, so the previous
-- release keeps working during a rollout: it never reads or writes these columns.
ALTER TABLE users
    ADD COLUMN map_palette TEXT NOT NULL DEFAULT 'standard' CHECK (map_palette IN ('standard', 'colorblind', 'print')),
    ADD COLUMN public_journeys BOOLEAN NOT NULL DEFAULT false;
