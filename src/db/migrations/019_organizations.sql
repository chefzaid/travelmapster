-- Organizations (ADR 0022, ADR 0029): members with roles, invitation links, employer rules, an
-- audit log of who looked at a member's counts, and business visits. Additive: the previous
-- release never reads them, and its visit updates leave the new columns alone.
CREATE TABLE organizations (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    organization_id BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('traveler', 'manager', 'admin')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX memberships_user_id_idx ON memberships (user_id);

CREATE TABLE invitations (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('traveler', 'manager', 'admin')),
    created_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    used_by BIGINT REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX invitations_organization_id_idx ON invitations (organization_id);

CREATE TABLE org_rules (
    organization_id BIGINT PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
    rules JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rules) = 'array'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    actor_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
    traveler_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_traveler_id_idx ON audit_log (traveler_id, at DESC);

-- Deleting an organization turns its business visits back into personal ones.
ALTER TABLE visits
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'personal' CHECK (purpose IN ('personal', 'business')),
    ADD COLUMN organization_id BIGINT REFERENCES organizations (id) ON DELETE SET NULL;

CREATE INDEX visits_organization_id_idx ON visits (organization_id) WHERE organization_id IS NOT NULL;

CREATE FUNCTION visits_personal_without_organization() RETURNS trigger AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        NEW.purpose := 'personal';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER visits_personal_without_organization
    BEFORE INSERT OR UPDATE OF organization_id, purpose ON visits
    FOR EACH ROW EXECUTE FUNCTION visits_personal_without_organization();
