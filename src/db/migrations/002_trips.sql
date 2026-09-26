CREATE TABLE trips (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    destination TEXT NOT NULL CHECK (length(destination) BETWEEN 1 AND 160),
    start_date DATE,
    plan JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(plan) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trips_user_id_idx ON trips (user_id);
