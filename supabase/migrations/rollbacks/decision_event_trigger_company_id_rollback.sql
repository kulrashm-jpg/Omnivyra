-- Rollback for 20270217000019_decision_event_trigger_company_id.
--
-- WARNING. This restores the 20260411 body, which inserts decision_events WITHOUT company_id.
-- On a schema where decision_events.company_id is NOT NULL (prod today), that is the DEFECT:
-- every decision_objects insert/update fails with 23502. Run it ONLY together with a schema
-- rollback that makes company_id nullable, or not at all. The search_path pin and the REVOKE are
-- KEPT: they match 20270111000003 and are not part of the defect.
-- The body is the 20260411 body BYTE FOR BYTE (LF; md5 8bad7afa08dc1226d6982f268ed92a28), so the
-- forward migration's preflight accepts it and the fix can be re-applied after a rollback.
-- CONSTRAINT (05): after a rollback the body is LF regardless of what prod started with (prod's
-- original is CRLF, md5 64faad0ef8a81658661c1dbef94e5ddf), so any future preflight on this function
-- must accept BOTH forms. CR is whitespace inside a plpgsql body; the two behave identically.

BEGIN;

CREATE OR REPLACE FUNCTION public.omnivyra_log_decision_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  detected_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO decision_events (decision_id, event_type, previous_value, new_value, changed_by)
    VALUES (NEW.id, 'created', NULL, to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));
    RETURN NEW;
  END IF;

  detected_event_type := 'updated';
  IF OLD.status <> 'resolved' AND NEW.status = 'resolved' THEN
    detected_event_type := 'resolved';
  ELSIF OLD.status IN ('resolved', 'ignored') AND NEW.status = 'open' THEN
    detected_event_type := 'reopened';
  END IF;

  INSERT INTO decision_events (decision_id, event_type, previous_value, new_value, changed_by)
  VALUES (NEW.id, detected_event_type, to_jsonb(OLD), to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omnivyra_log_decision_event() FROM PUBLIC, anon, authenticated;

COMMIT;
