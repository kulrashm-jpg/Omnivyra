-- Rollback of 20270217000003_payment_provider_event_state_writer.
-- Sound by PROVENANCE (05's rollback rule): all three object names originate in
-- 20270217000003 itself. Functions are dropped WITHOUT CASCADE (a dependant must
-- stop the rollback, not be removed silently). The attributes table is dropped
-- only while EMPTY: dropping it with rows would destroy enrichment written since
-- the apply - export / resolve those rows first.
-- The 20260663 side table, its rows and the old RPC are untouched.
DO $pre$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.payment_provider_event_attributes') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.payment_provider_event_attributes' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'payment_provider_event_state_writer rollback: the attributes table holds % row(s) - export them first; nothing changed', n;
    END IF;
  END IF;
END
$pre$;
DROP FUNCTION IF EXISTS public.set_payment_provider_event_attributes(uuid, jsonb);
DROP FUNCTION IF EXISTS public.advance_payment_provider_event_state_guarded(uuid, text, text);
DROP TABLE IF EXISTS public.payment_provider_event_attributes;
