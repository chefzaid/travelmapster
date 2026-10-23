-- The list of countries a traveler counts against (ADR 0015): every territory on the map
-- ('all', as before) or UN members and observer states ('un'). Additive with a default, so the
-- previous release keeps working during a rollout and never changes it.
ALTER TABLE users
    ADD COLUMN country_list TEXT NOT NULL DEFAULT 'all' CHECK (country_list IN ('all', 'un'));
