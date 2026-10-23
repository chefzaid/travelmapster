-- Wishlist plans (ADR 0012): how much the traveler wants to go and the best months to go.
-- Additive with defaults, so the previous release keeps working during a rollout and its
-- updates leave both columns as they are.
ALTER TABLE markers
    ADD COLUMN priority TEXT CHECK (priority IN ('high', 'medium', 'low')),
    ADD COLUMN best_months SMALLINT[] NOT NULL DEFAULT '{}'
        CHECK (best_months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::SMALLINT[]);
