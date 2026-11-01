-- Travel documents in the day ledger: passports, ID cards, visas and residence permits with
-- their validity dates, never their numbers. Additive: the previous release never reads the
-- column, and a save that leaves it out keeps it.
ALTER TABLE ledger_settings
    ADD COLUMN documents JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(documents) = 'array');
