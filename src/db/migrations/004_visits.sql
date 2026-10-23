-- Expand step of splitting saved places into places and dated visits (ADR 0009).
-- `markers` stays the places table. Each visit is a span of local calendar dates at the
-- destination (no time zone); a missing end date means the end was not recorded.
CREATE TABLE visits (
    id BIGSERIAL PRIMARY KEY,
    marker_id BIGINT NOT NULL REFERENCES markers (id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE CHECK (end_date IS NULL OR end_date >= start_date),
    notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
    photo_url TEXT CHECK (photo_url IS NULL OR length(photo_url) <= 2048),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visits_marker_id_start_date_idx ON visits (marker_id, start_date DESC);

-- Backfill: the single travel date of every place becomes its first visit.
INSERT INTO visits (marker_id, start_date, created_at, updated_at)
SELECT id, travel_date, created_at, updated_at FROM markers WHERE travel_date IS NOT NULL;

-- Until the contract step, markers.travel_date mirrors the start of the latest visit so
-- the previous release keeps reading and writing it during a rollout or rollback.

-- Visits changed directly keep the mirror up to date. Changes made by the triggers
-- below (pg_trigger_depth() > 1) set the mirror themselves.
CREATE FUNCTION visits_sync_travel_date() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    affected BIGINT;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    FOREACH affected IN ARRAY ARRAY[
        CASE WHEN TG_OP <> 'DELETE' THEN NEW.marker_id END,
        CASE WHEN TG_OP <> 'INSERT' THEN OLD.marker_id END
    ] LOOP
        CONTINUE WHEN affected IS NULL;
        UPDATE markers SET travel_date = latest.start_date
        FROM (SELECT max(start_date) AS start_date FROM visits WHERE marker_id = affected) AS latest
        WHERE markers.id = affected AND markers.travel_date IS DISTINCT FROM latest.start_date;
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE TRIGGER visits_sync_travel_date
AFTER INSERT OR UPDATE OR DELETE ON visits
FOR EACH ROW EXECUTE FUNCTION visits_sync_travel_date();

-- A travel date written the old way only ever adds a visit, never moves or deletes one:
-- a new place with a date gets that visit, and a changed date adds a visit unless one
-- already starts that day. The mirror then shows the latest visit again, so clearing
-- the date the old way keeps every visit.
CREATE FUNCTION markers_legacy_travel_date_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() = 1 AND NEW.travel_date IS NOT NULL THEN
        INSERT INTO visits (marker_id, start_date) VALUES (NEW.id, NEW.travel_date);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER markers_legacy_travel_date_insert
AFTER INSERT ON markers
FOR EACH ROW EXECUTE FUNCTION markers_legacy_travel_date_insert();

CREATE FUNCTION markers_legacy_travel_date_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;
    IF NEW.travel_date IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM visits WHERE marker_id = NEW.id AND start_date = NEW.travel_date
    ) THEN
        INSERT INTO visits (marker_id, start_date) VALUES (NEW.id, NEW.travel_date);
    END IF;
    NEW.travel_date := (SELECT max(start_date) FROM visits WHERE marker_id = NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER markers_legacy_travel_date_update
BEFORE UPDATE OF travel_date ON markers
FOR EACH ROW EXECUTE FUNCTION markers_legacy_travel_date_update();
