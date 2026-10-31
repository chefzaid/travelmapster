-- Days that do not count (ADR 0010): periods under a residence permit or long-stay visa, whose
-- days in the countries it covers are left out of the stay rules. Additive: the previous
-- release never reads the column, and its saves leave it alone.
ALTER TABLE ledger_settings
    ADD COLUMN exempt JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(exempt) = 'array');
