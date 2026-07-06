ALTER TABLE session_events
  ADD COLUMN IF NOT EXISTS slot_updates_json JSONB NOT NULL DEFAULT '{}'::jsonb;
