-- Rollback for the report_settings key-merge RPC migration (placeholder version 20270116000000).
--
-- ORDER MATTERS: roll back the APPLICATION first. Once the backend calls
-- merge_report_settings_keys, dropping the function makes every system writer of
-- report_settings fail (they refuse rather than fall back to a whole-column write).
-- With the application rolled back, nothing calls the function and it can go.
-- No data is touched: the function only ever wrote report_settings keys, which stay.

BEGIN;

DROP FUNCTION IF EXISTS public.merge_report_settings_keys(text, jsonb, timestamptz, text[], text[]);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname = 'merge_report_settings_keys') THEN
    RAISE EXCEPTION 'RS-MERGE rollback: public.merge_report_settings_keys still exists';
  END IF;
END
$verify$;

COMMIT;
