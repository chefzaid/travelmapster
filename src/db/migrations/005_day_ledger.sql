-- Day ledger (ADR 0010): stays that are still going on, the traveler's counting settings,
-- and a history of every change to visit dates. Additive only, so the previous release
-- keeps working during a rollout: it never writes `ongoing`, which then stays false.

-- A visit without an end date either has an end that was not recorded (counted as its
-- first day only) or is still going on (counted through today). An end date always wins,
-- so a visit edited by the previous release simply stops being ongoing for the ledger.
ALTER TABLE visits ADD COLUMN ongoing BOOLEAN NOT NULL DEFAULT false;

-- One row per traveler, created on first save. `rules` holds stay rules and thresholds,
-- `planned` the planned stays used for simulations; both are validated by the API.
CREATE TABLE ledger_settings (
    user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    day_rule TEXT NOT NULL DEFAULT 'presence' CHECK (day_rule IN ('presence', 'midnight')),
    rules JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rules) = 'array'),
    planned JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(planned) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only history of visit dates for evidence reports. It outlives the visit and its
-- place (no foreign key to either, and the place name is copied), and goes with the account.
CREATE TABLE visit_changes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    visit_id BIGINT NOT NULL,
    marker_id BIGINT NOT NULL,
    place_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('added', 'changed', 'removed')),
    old_start_date DATE,
    old_end_date DATE,
    old_ongoing BOOLEAN,
    new_start_date DATE,
    new_end_date DATE,
    new_ongoing BOOLEAN,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visit_changes_user_id_changed_at_idx ON visit_changes (user_id, changed_at DESC, id DESC);

-- Triggers record every write, including those of the previous release and of the legacy
-- travel-date triggers of migration 004. Edits to notes or photo links are not recorded.
CREATE FUNCTION visits_record_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO visit_changes (user_id, visit_id, marker_id, place_name, action,
            new_start_date, new_end_date, new_ongoing)
        SELECT m.user_id, NEW.id, NEW.marker_id, m.name, 'added', NEW.start_date, NEW.end_date, NEW.ongoing
        FROM markers m WHERE m.id = NEW.marker_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (NEW.start_date, NEW.end_date, NEW.ongoing) IS NOT DISTINCT FROM (OLD.start_date, OLD.end_date, OLD.ongoing) THEN
            RETURN NULL;
        END IF;
        INSERT INTO visit_changes (user_id, visit_id, marker_id, place_name, action,
            old_start_date, old_end_date, old_ongoing, new_start_date, new_end_date, new_ongoing)
        SELECT m.user_id, NEW.id, NEW.marker_id, m.name, 'changed', OLD.start_date, OLD.end_date, OLD.ongoing,
            NEW.start_date, NEW.end_date, NEW.ongoing
        FROM markers m WHERE m.id = NEW.marker_id;
    ELSE
        -- Visits removed with their place were recorded before the place went (below);
        -- by now the place is gone, so nothing is inserted twice.
        INSERT INTO visit_changes (user_id, visit_id, marker_id, place_name, action,
            old_start_date, old_end_date, old_ongoing)
        SELECT m.user_id, OLD.id, OLD.marker_id, m.name, 'removed', OLD.start_date, OLD.end_date, OLD.ongoing
        FROM markers m WHERE m.id = OLD.marker_id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER visits_record_change
AFTER INSERT OR UPDATE OR DELETE ON visits
FOR EACH ROW EXECUTE FUNCTION visits_record_change();

-- Removing a place removes its visits. Deleting the whole account records nothing: the
-- user row is already gone, and the history goes with it.
CREATE FUNCTION markers_record_visit_removals() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO visit_changes (user_id, visit_id, marker_id, place_name, action,
        old_start_date, old_end_date, old_ongoing)
    SELECT OLD.user_id, v.id, v.marker_id, OLD.name, 'removed', v.start_date, v.end_date, v.ongoing
    FROM visits v
    WHERE v.marker_id = OLD.id AND EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id);
    RETURN OLD;
END;
$$;

CREATE TRIGGER markers_record_visit_removals
BEFORE DELETE ON markers
FOR EACH ROW EXECUTE FUNCTION markers_record_visit_removals();
