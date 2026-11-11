-- Rollback for 20270215000000_whatsapp_broadcast_counts_refresh.sql.
--
-- Removes the refresh function and the four columns it added. The counts themselves
-- (sent_count etc.) are pre-existing columns and keep their last recomputed values.
-- Roll back the application change (calls to whatsapp_refresh_broadcast_counts) FIRST:
-- without the function those calls log an ERROR and the counts stop updating. The
-- explicit service_role grants are left in place (service_role already holds them on
-- hosted Supabase).

BEGIN;

DROP FUNCTION IF EXISTS public.whatsapp_refresh_broadcast_counts(uuid, integer);
ALTER TABLE public.whatsapp_broadcasts DROP COLUMN IF EXISTS uncertain_count;
ALTER TABLE public.whatsapp_broadcasts DROP COLUMN IF EXISTS open_count;
ALTER TABLE public.whatsapp_broadcasts DROP COLUMN IF EXISTS counts_dirty;
ALTER TABLE public.whatsapp_broadcasts DROP COLUMN IF EXISTS counts_refreshed_at;

DO $verify$
BEGIN
  IF to_regprocedure('public.whatsapp_refresh_broadcast_counts(uuid, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'WBC rollback: the function still exists';
  END IF;
END
$verify$;

COMMIT;
