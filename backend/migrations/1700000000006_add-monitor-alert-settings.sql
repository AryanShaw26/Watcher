-- Up Migration
ALTER TABLE monitors
  ADD COLUMN failure_threshold         integer     NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 10),
  ADD COLUMN recovery_threshold        integer     NOT NULL DEFAULT 2 CHECK (recovery_threshold BETWEEN 1 AND 10),
  ADD COLUMN alerts_enabled            boolean     NOT NULL DEFAULT true,
  ADD COLUMN consecutive_successes     integer     NOT NULL DEFAULT 0,
  ADD COLUMN failure_streak_started_at timestamptz;

-- Down Migration
ALTER TABLE monitors
  DROP COLUMN failure_streak_started_at,
  DROP COLUMN consecutive_successes,
  DROP COLUMN alerts_enabled,
  DROP COLUMN recovery_threshold,
  DROP COLUMN failure_threshold;
