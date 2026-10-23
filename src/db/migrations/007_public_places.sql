-- A traveler can keep single places off their public map (ADR 0013). Additive with a
-- default that shares the place, as before; the previous release never writes the column
-- and its updates leave it as it is.
ALTER TABLE markers ADD COLUMN hide_from_public BOOLEAN NOT NULL DEFAULT false;
