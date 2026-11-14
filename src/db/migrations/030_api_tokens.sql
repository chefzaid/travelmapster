-- Personal API tokens: read-only access to the traveler's own data on the documented API, for
-- an accountant's or HR system's integration. Only a SHA-256 hash of each token is stored; a
-- token is shown once and can be revoked. Additive.
CREATE TABLE api_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);

-- Making and revoking a token join the security activity.
ALTER TABLE security_events DROP CONSTRAINT security_events_kind_check;
ALTER TABLE security_events ADD CONSTRAINT security_events_kind_check CHECK (kind IN (
    'sign_in', 'password_changed', 'passkey_added', 'passkey_removed', 'two_step_on', 'two_step_off',
    'deletion_requested', 'account_restored', 'api_token_created', 'api_token_revoked'
));
