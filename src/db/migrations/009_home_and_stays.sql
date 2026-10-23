-- Lived-there and transit-only places, and a home country per traveler (ADR 0014). Additive
-- with defaults, so the previous release keeps working during a rollout: it never writes
-- these columns, which keep their defaults, and its updates leave them as they are. It reads
-- a lived-there or transit place as a plain "been there" one.

-- How the traveler was at a place they have been to: a visit, a home they lived in, or a
-- layover. The API keeps it at 'visit' for wishlist places and reads it only for visited ones.
ALTER TABLE markers
    ADD COLUMN stay TEXT NOT NULL DEFAULT 'visit' CHECK (stay IN ('visit', 'lived', 'transit'));

-- A map country code such as FRA; the home country is never shared on a public map.
ALTER TABLE users
    ADD COLUMN home_country TEXT CHECK (home_country ~ '^[A-Z]{3}$');
