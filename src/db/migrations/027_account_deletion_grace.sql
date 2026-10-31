-- Account deletion with a 30-day grace period: deleting an account records when, signing in
-- before the period ends clears it, and the account is deleted for good once it has passed.
-- Additive: the previous release neither reads nor writes the column.
ALTER TABLE users ADD COLUMN deletion_requested_at TIMESTAMPTZ;
CREATE INDEX users_deletion_requested_at ON users (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;

-- The security activity notes a deletion asked for and an account restored by signing in.
ALTER TABLE security_events DROP CONSTRAINT security_events_kind_check;
ALTER TABLE security_events ADD CONSTRAINT security_events_kind_check CHECK (kind IN (
    'sign_in', 'password_changed', 'passkey_added', 'passkey_removed', 'two_step_on', 'two_step_off',
    'deletion_requested', 'account_restored'
));
