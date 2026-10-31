-- Family view of a trip: one private, read-only link per trip to its stops and dates, for
-- family without an account. Only a SHA-256 hash of the link's token is stored; a new link
-- replaces the old one and turning it off deletes the row. Additive.
CREATE TABLE trip_family_links (
    trip_id BIGINT PRIMARY KEY REFERENCES trips (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
