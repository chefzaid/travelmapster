-- Ratings, tags and a custom emoji per place (ADR 0012). Additive only, so the previous
-- release keeps working during a rollout: it never writes these columns, which then keep
-- their defaults, and its updates leave them as they are.

-- Each tag is 1 to 24 characters, at most 8 per place; the API also lowercases them and
-- limits them to letters, digits, spaces, dashes, apostrophes and ampersands.
CREATE FUNCTION marker_tags_valid(tags TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT cardinality(tags) <= 8
        AND coalesce((SELECT bool_and(length(tag) BETWEEN 1 AND 24) FROM unnest(tags) AS tag), true)
$$;

ALTER TABLE markers
    ADD COLUMN rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}' CHECK (marker_tags_valid(tags)),
    -- One emoji, checked by the API; even long ZWJ sequences stay under 16 code points.
    ADD COLUMN emoji TEXT CHECK (emoji IS NULL OR length(emoji) BETWEEN 1 AND 16);
