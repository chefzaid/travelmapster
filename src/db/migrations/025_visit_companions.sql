-- Who came along on a visit: names only, never accounts. Additive: the previous release
-- neither reads nor writes the column, and an update that leaves it out keeps it.
ALTER TABLE visits
    ADD COLUMN companions TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(companions) <= 10);
