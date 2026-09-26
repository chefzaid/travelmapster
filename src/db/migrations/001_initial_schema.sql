CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    profile_visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (profile_visibility IN ('private', 'public')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usernames are unique regardless of case so "Alice" cannot impersonate "alice".
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

CREATE TABLE markers (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    type TEXT NOT NULL CHECK (type IN ('visited', 'wishlist')),
    category TEXT NOT NULL CHECK (category IN ('Country', 'City')),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    photo_url TEXT CHECK (photo_url IS NULL OR length(photo_url) <= 2048),
    notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
    travel_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX markers_user_id_idx ON markers (user_id);

-- Session store used by connect-pg-simple.
CREATE TABLE sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX sessions_expire_idx ON sessions (expire);
