-- Rollback for 20270217000028_scheduled_posts_company_id.sql.
-- Removes the guard triggers and function, the FK, the index and the column. Idempotent.
-- Provenance: it REFUSES to drop a company_id column when the guard function is absent, unless the
-- column is absent too (already rolled back): only what 028 created is removed (028's preflight
-- refuses to adopt a pre-existing column, so column + guard together prove 028 created it).
-- WHAT IS LOST (05 review): populations (a) and (b) are recomputable by re-applying 028 (the
-- campaign's and the account's company are still there). Population (c) is NOT: it was a judgement
-- at apply time ("the creator's single ACTIVE company"); if the creator has since joined or left a
-- company, a re-apply RAISEs instead of reproducing it. Rows the trigger filled after apply whose
-- campaign or account was later removed are likewise not re-derivable. Export
-- (id, company_id) before running this if those values must survive.
-- WARNING: after this, the database no longer refuses a post whose campaign and social account are
-- in different companies; only the application resolver does.

BEGIN;

DO $provenance$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass
              AND attname = 'company_id' AND NOT attisdropped)
     AND to_regprocedure('public.scheduled_posts_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'SP-COMPANY rollback: scheduled_posts.company_id exists without the 028 guard function; it was not created by 028, refusing to drop it';
  END IF;
END
$provenance$;

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
