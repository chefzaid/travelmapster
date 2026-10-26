-- Whether a public map may appear in search results and the sitemap (ADR 0023). Additive with a
-- default, so the previous release keeps working during a rollout: it never reads the column.
ALTER TABLE users ADD COLUMN public_indexing BOOLEAN NOT NULL DEFAULT false;
