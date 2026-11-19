-- Up Migration
CREATE TABLE notification_channels (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                     text         NOT NULL CHECK (type IN ('webhook','slack','discord','email')),
  name                     varchar(100) NOT NULL,
  target_encrypted         text,
  signing_secret_encrypted text,
  is_active                boolean      NOT NULL DEFAULT true,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX notification_channels_user_idx ON notification_channels (user_id);

-- Down Migration
DROP TABLE notification_channels;
