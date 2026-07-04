CREATE TABLE IF NOT EXISTS scenario_versions (
  tenant_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  graph_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version_number INTEGER NOT NULL DEFAULT 1,
  correlation_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, scenario_id, scenario_version)
);

CREATE TABLE IF NOT EXISTS sessions (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  current_scene_id TEXT NOT NULL,
  slots_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  sequence_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version_number INTEGER NOT NULL DEFAULT 1,
  correlation_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (tenant_id, scenario_id, scenario_version)
    REFERENCES scenario_versions (tenant_id, scenario_id, scenario_version)
);

CREATE TABLE IF NOT EXISTS session_events (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  transition_id TEXT,
  from_scene_id TEXT NOT NULL,
  to_scene_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('transitioned', 'guard_failed')),
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, session_id, sequence_number),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES sessions (tenant_id, session_id)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_hash TEXT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_scenario
  ON sessions (tenant_id, scenario_id, scenario_version);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_subject
  ON audit_events (tenant_id, subject_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (tenant_id, status, created_at);
