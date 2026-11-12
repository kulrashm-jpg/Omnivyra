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
-- ORDER: roll back 20270217000029 FIRST (its hard_delete_company body reads scheduled_posts.company_id).
-- WARNING: after this, the database no longer refuses a post whose campaign and social account are
-- in different companies, nor a social account moving between companies; only application code does.

BEGIN;

DO $provenance$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass
              AND attname = 'company_id' AND NOT attisdropped)
     AND to_regprocedure('public.scheduled_posts_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'SP-COMPANY rollback: scheduled_posts.company_id exists without the 028 guard function; it was not created by 028, refusing to drop it';
  END IF;
  -- 029's hard_delete_company counts scheduled_posts.company_id: dropping the column under it would
  -- succeed here and break every later hard delete (05 review). Enforce the order.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.hard_delete_company(uuid, uuid, text)')
              AND md5(replace(prosrc, E'\r', '')) = '3f2c47120b18bb9e0d98d95e74fcbb29') THEN
    RAISE EXCEPTION 'SP-COMPANY rollback: roll back 20270217000029 first (hard_delete_company still reads scheduled_posts.company_id)';
  END IF;
END
$provenance$;

DROP TRIGGER IF EXISTS social_accounts_company_id_immutable ON public.social_accounts;
DROP FUNCTION IF EXISTS public.social_accounts_company_id_immutable();
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
