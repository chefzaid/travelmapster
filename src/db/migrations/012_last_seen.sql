-- The last day each account was used, for aggregate activity and retention metrics: a date,
-- never a time or a place, written at most once a day. Additive with no default, so the
-- previous release keeps working during a rollout: it never reads or writes the column.
ALTER TABLE users ADD COLUMN last_seen_on DATE;
