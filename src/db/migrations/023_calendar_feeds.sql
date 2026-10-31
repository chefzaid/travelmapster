-- Calendar subscription: one private feed per traveler of their trips and planned stays, for
-- Google, Apple or Outlook calendars. Only a SHA-256 hash of the link's token is stored; a new
-- link replaces the old one and turning it off deletes the row. Additive.
CREATE TABLE calendar_feeds (
    user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
