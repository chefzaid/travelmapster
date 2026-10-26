-- Friends (ADR 0028): public maps a traveler follows, and the accounts a trip is shared with.
-- New tables only: the previous release never reads them.
CREATE TABLE follows (
    follower_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    followee_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);

CREATE INDEX follows_followee_id_idx ON follows (followee_id);

CREATE TABLE trip_members (
    trip_id BIGINT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('edit', 'view')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX trip_members_user_id_idx ON trip_members (user_id);
