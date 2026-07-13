ALTER TABLE scenario_versions
  ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS scenario_content_hash TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION reject_published_scenario_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' AND (
    NEW.graph_json IS DISTINCT FROM OLD.graph_json OR
    NEW.content_hash IS DISTINCT FROM OLD.content_hash
  ) THEN
    RAISE EXCEPTION 'published scenario versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scenario_versions_immutable ON scenario_versions;
CREATE TRIGGER scenario_versions_immutable
BEFORE UPDATE ON scenario_versions
FOR EACH ROW EXECUTE FUNCTION reject_published_scenario_mutation();
