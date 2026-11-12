-- Rollback for 20270217000028_scheduled_posts_company_id.sql.
-- Removes the guard triggers and function, the FK, the index and the column. The column is derived
-- data (from the campaign, the account or the creator's single active membership), so dropping it
-- loses nothing that cannot be recomputed by re-applying the migration. Idempotent.
-- WARNING: after this, the database no longer refuses a post whose campaign and social account are
-- in different companies; only the application resolver does.

BEGIN;

DROP TRIGGER IF EXISTS scheduled_posts_company_id_guard_ins ON public.scheduled_posts;
DROP TRIGGER IF EXISTS scheduled_posts_company_id_guard_upd ON public.scheduled_posts;
DROP FUNCTION IF EXISTS public.scheduled_posts_company_id_guard();
ALTER TABLE public.scheduled_posts DROP CONSTRAINT IF EXISTS scheduled_posts_company_id_fkey;
DROP INDEX IF EXISTS public.idx_scheduled_posts_company_id;
ALTER TABLE public.scheduled_posts DROP COLUMN IF EXISTS company_id;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass
              AND attname = 'company_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'SP-COMPANY rollback verify: scheduled_posts.company_id still exists';
  END IF;
  IF to_regprocedure('public.scheduled_posts_company_id_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'SP-COMPANY rollback verify: guard function still exists';
  END IF;
END
$verify$;

COMMIT;
