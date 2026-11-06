-- Rollback for 20270128000002_whatsapp_provider_event_ledger.sql
--
-- Refuses while the ledger holds rows: dropping it would erase the only record of
-- those provider events. Export them first.

DO $wpe_rollback$
DECLARE
  v_rows boolean;
BEGIN
  IF to_regclass('public.whatsapp_provider_events') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.whatsapp_provider_events)' INTO v_rows;
    IF v_rows THEN
      RAISE EXCEPTION 'whatsapp_provider_events has rows; export them before rolling back';
    END IF;
  END IF;
END
$wpe_rollback$;

DROP TABLE IF EXISTS public.whatsapp_provider_events;
DROP FUNCTION IF EXISTS public.whatsapp_provider_events_append_only();
