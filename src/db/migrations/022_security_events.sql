-- Security activity (ADR 0027): sign-ins and changes to how an account signs in, so a traveler
-- notices an intruder. The browser and system names only, never the User-Agent or an address;
-- the latest 50 per account are kept. Additive: the previous release never writes it.
CREATE TABLE security_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('sign_in', 'password_changed', 'passkey_added', 'passkey_removed', 'two_step_on', 'two_step_off')),
    method TEXT CHECK (method IN ('password', 'authenticator', 'recovery_code', 'passkey')),
    browser TEXT,
    os TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX security_events_user_id_created_at_idx ON security_events (user_id, created_at DESC, id DESC);
