BEGIN;

ALTER TABLE decision_events
  ADD COLUMN IF NOT EXISTS company_id UUID;

UPDATE decision_events de
SET company_id = d.company_id
FROM decision_objects d
WHERE de.decision_id = d.id
  AND de.company_id IS NULL;

ALTER TABLE decision_events
  ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_events_company_fk'
  ) THEN
    ALTER TABLE decision_events
      ADD CONSTRAINT decision_events_company_fk
      FOREIGN KEY (company_id)
      REFERENCES companies(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_decision_events_company_created
  ON decision_events(company_id, created_at DESC);

CREATE OR REPLACE FUNCTION omnivyra_log_decision_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  detected_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO decision_events (decision_id, company_id, event_type, previous_value, new_value, changed_by)
    VALUES (NEW.id, NEW.company_id, 'created', NULL, to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));
    RETURN NEW;
  END IF;

  detected_event_type := 'updated';
  IF OLD.status <> 'resolved' AND NEW.status = 'resolved' THEN
    detected_event_type := 'resolved';
  ELSIF OLD.status IN ('resolved', 'ignored') AND NEW.status = 'open' THEN
    detected_event_type := 'reopened';
  END IF;

  INSERT INTO decision_events (decision_id, company_id, event_type, previous_value, new_value, changed_by)
  VALUES (NEW.id, NEW.company_id, detected_event_type, to_jsonb(OLD), to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));

  RETURN NEW;
END;
$$;

COMMIT;
