-- Packing list templates saved on the account, to start a trip's list from. Additive: the
-- previous release neither reads nor writes the column.
ALTER TABLE users
    ADD COLUMN packing_templates JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(packing_templates) = 'array');
