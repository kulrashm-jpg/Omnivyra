-- Rollback for 20270217000030_content_analytics_company_id.sql.
-- Removes the guard triggers and function, the FK, the index and the column. Idempotent. Nothing is lost: the
-- column is fully re-derivable from each row's scheduled post (re-apply 030).
-- Provenance: it REFUSES to drop a company_id column when the guard function is absent, unless the column is absent
-- too (already rolled back): only what 030 created is removed (030's preflight refuses to adopt a pre-existing column).
-- ORDER: roll this back BEFORE 20270217000028 (its preflight requires scheduled_posts.company_id).

BEGIN;

DO $provenance$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.content_analytics'::regclass
              AND attname = 'company_id' AND NOT attisdropped)
     AND to_regprocedure('public.content_analytics_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'CA-COMPANY rollback: content_analytics.company_id exists without the 030 guard function; it was not created by 030, refusing to drop it';
  END IF;
END
$provenance$;

DROP TRIGGER IF EXISTS content_analytics_company_id_guard_ins ON public.content_analytics;
DROP TRIGGER IF EXISTS content_analytics_company_id_guard_upd ON public.content_analytics;
DROP FUNCTION IF EXISTS public.content_analytics_company_id_guard();
ALTER TABLE public.content_analytics DROP CONSTRAINT IF EXISTS content_analytics_company_id_fkey;
DROP INDEX IF EXISTS public.idx_content_analytics_company_id;
ALTER TABLE public.content_analytics DROP COLUMN IF EXISTS company_id;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.content_analytics'::regclass
              AND attname = 'company_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CA-COMPANY rollback verify: content_analytics.company_id still exists';
  END IF;
  IF to_regprocedure('public.content_analytics_company_id_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'CA-COMPANY rollback verify: guard function still exists';
  END IF;
END
$verify$;

COMMIT;
