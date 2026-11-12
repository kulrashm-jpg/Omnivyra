-- Rollback of 20270217000006_whatsapp_templates_active_unique.sql.
-- ORDER: roll the CODE back first (it calls whatsapp_apply_template_status). Drops the function, the
-- unique index and status_event_at (loses only the last-applied event times; ordering protection ends).
BEGIN;
DROP FUNCTION IF EXISTS public.whatsapp_apply_template_status(uuid, text, timestamptz, text);
DROP INDEX IF EXISTS public.whatsapp_templates_one_active;
ALTER TABLE public.whatsapp_templates DROP COLUMN IF EXISTS status_event_at;
DO $verify$
BEGIN
  IF to_regprocedure('public.whatsapp_apply_template_status(uuid, text, timestamptz, text)') IS NOT NULL
     OR to_regclass('public.whatsapp_templates_one_active') IS NOT NULL THEN
    RAISE EXCEPTION 'WTAU rollback postcondition: the function and the index must be gone';
  END IF;
END
$verify$;
COMMIT;
