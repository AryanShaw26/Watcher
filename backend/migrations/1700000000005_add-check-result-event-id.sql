-- Up Migration
ALTER TABLE check_results
  ADD COLUMN event_id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE check_results
  ADD CONSTRAINT check_results_event_id_uq UNIQUE (event_id);

-- Down Migration
ALTER TABLE check_results DROP CONSTRAINT check_results_event_id_uq;
ALTER TABLE check_results DROP COLUMN event_id;
