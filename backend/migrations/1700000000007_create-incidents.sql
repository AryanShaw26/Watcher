-- Up Migration
CREATE TABLE incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id       uuid        NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL,
  resolved_at      timestamptz,
  failed_checks    integer     NOT NULL DEFAULT 0,
  opened_error     text,
  last_error       text,
  last_status_code integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_resolved_after_start CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);
CREATE UNIQUE INDEX incidents_one_open_per_monitor ON incidents (monitor_id) WHERE resolved_at IS NULL;
CREATE INDEX incidents_monitor_started_idx ON incidents (monitor_id, started_at DESC);
CREATE INDEX incidents_started_idx ON incidents (started_at DESC);

-- Down Migration
DROP TABLE incidents;
