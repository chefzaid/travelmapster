-- Pre-trip checklists (ADR 0030): an organization's list of tasks before a trip, and business
-- trips for an organization. Additive: the previous release never reads them, and its trip
-- updates leave the new column alone.
ALTER TABLE org_rules
    ADD COLUMN checklist JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checklist) = 'array');

-- Deleting an organization turns its business trips back into personal ones.
ALTER TABLE trips
    ADD COLUMN organization_id BIGINT REFERENCES organizations (id) ON DELETE SET NULL;

CREATE INDEX trips_organization_id_idx ON trips (organization_id) WHERE organization_id IS NOT NULL;
