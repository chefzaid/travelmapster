-- Flight log: flights by airport codes and date, for arcs on the map and the distance flown
-- per year. Additive: the previous release never reads the table.
CREATE TABLE flights (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    flown_on DATE NOT NULL,
    origin CHAR(3) NOT NULL CHECK (origin ~ '^[A-Z]{3}$'),
    destination CHAR(3) NOT NULL CHECK (destination ~ '^[A-Z]{3}$' AND destination <> origin),
    flight_number TEXT CHECK (char_length(flight_number) <= 12),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX flights_user_id_flown_on_idx ON flights (user_id, flown_on DESC, id DESC);
