-- Up Migration
CREATE TABLE check_results (
  id bigserial PRIMARY KEY,
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('up','down')),
  status_code integer,
  response_time_ms integer,
  error text
);
CREATE INDEX check_results_monitor_time_idx ON check_results (monitor_id, checked_at DESC);
CREATE INDEX check_results_checked_at_idx ON check_results (checked_at);

-- Down Migration
DROP TABLE check_results;
