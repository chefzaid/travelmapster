-- Yearly travel goals, such as three new countries in 2027: a JSON list validated by the API.
-- Additive with a default, so the previous release keeps working during a rollout: it never
-- reads or writes the column.
ALTER TABLE users ADD COLUMN goals JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(goals) = 'array');
