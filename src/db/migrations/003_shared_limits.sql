-- Counters shared by every replica, so rate limits and the Nominatim throttle hold
-- for the whole service rather than per process. Losing them in a crash is harmless.
CREATE UNLOGGED TABLE rate_limits (
    key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX rate_limits_reset_at_idx ON rate_limits (reset_at);

-- One row holding the earliest time the next geocoder request may start.
CREATE TABLE geocoder_throttle (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    next_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO geocoder_throttle (id) VALUES (1);
