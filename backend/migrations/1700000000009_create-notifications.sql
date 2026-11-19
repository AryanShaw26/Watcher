-- Up Migration
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      uuid        REFERENCES notification_channels(id) ON DELETE SET NULL,
  channel_type    text        NOT NULL,
  channel_name    text        NOT NULL,
  monitor_id      uuid        REFERENCES monitors(id) ON DELETE SET NULL,
  incident_id     uuid        REFERENCES incidents(id) ON DELETE SET NULL,
  type            text        NOT NULL CHECK (type IN ('incident.opened','incident.resolved','test')),
  payload         jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','sent','failed','suppressed')),
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX notifications_due_idx ON notifications (next_attempt_at) WHERE status IN ('pending','sending');
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (incident_id, channel_id, type)
  WHERE incident_id IS NOT NULL AND channel_id IS NOT NULL;

-- Down Migration
DROP TABLE notifications;
