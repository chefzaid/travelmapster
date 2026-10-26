-- A packing list and a budget per trip. Additive: the previous release neither reads nor
-- writes them, and an update that leaves them out keeps the stored ones.
ALTER TABLE trips
    ADD COLUMN packing JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(packing) = 'array'),
    ADD COLUMN budget JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(budget) = 'object');
