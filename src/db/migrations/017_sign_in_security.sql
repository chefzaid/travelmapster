-- Passkeys, two-step sign-in secrets and recovery codes (ADR 0027). New tables only: the
-- previous release never reads them, and each goes with its account.
CREATE TABLE passkeys (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 1400),
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    public_key BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0 CHECK (counter >= 0),
    transports TEXT[] NOT NULL DEFAULT '{}',
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX passkeys_user_id_idx ON passkeys (user_id);

-- A secret waiting for its first code has no enabled_at; last_step refuses a code used twice.
CREATE TABLE totp_secrets (
    user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    enabled_at TIMESTAMPTZ,
    last_step BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_codes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX recovery_codes_user_id_idx ON recovery_codes (user_id);
