-- Up Migration
CREATE TABLE monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  url text NOT NULL,
  method text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','HEAD')),
  interval_seconds integer NOT NULL DEFAULT 300 CHECK (interval_seconds BETWEEN 30 AND 86400),
  expected_status_code integer NOT NULL DEFAULT 200 CHECK (expected_status_code BETWEEN 100 AND 599),
  timeout_ms integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  is_active boolean NOT NULL DEFAULT true,
  current_status text NOT NULL DEFAULT 'pending' CHECK (current_status IN ('pending','up','down')),
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  last_response_time_ms integer,
  last_status_code integer,
  last_error text,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monitors_user_idx ON monitors (user_id);
CREATE INDEX monitors_due_idx ON monitors (next_check_at) WHERE is_active;

-- Down Migration
DROP TABLE monitors;
