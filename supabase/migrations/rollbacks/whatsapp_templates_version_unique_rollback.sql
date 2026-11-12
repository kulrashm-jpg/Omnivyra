-- Rollback of 20270217000007_whatsapp_templates_version_unique.sql. Drops the unique index only.
-- SOUND TO DROP: the apply's preflight refuses any pre-existing object of this name that is not
-- exactly this index, so the only index this can remove is the one the migration created.
BEGIN;
DROP INDEX IF EXISTS public.whatsapp_templates_version_unique;
DO $verify$
BEGIN
  IF to_regclass('public.whatsapp_templates_version_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'WTVU rollback postcondition: the index must be gone';
  END IF;
END
$verify$;
COMMIT;
