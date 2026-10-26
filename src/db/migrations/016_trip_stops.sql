-- The destinations of a trip with several, each with its number of days. Additive: the previous
-- release neither reads nor writes them, and an update that leaves them out keeps the stored ones.
ALTER TABLE trips
    ADD COLUMN stops JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(stops) = 'array');
