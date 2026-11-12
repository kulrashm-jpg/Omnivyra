-- content_analytics gains company_id (NOT NULL, FK -> companies ON DELETE RESTRICT), backfilled from its scheduled
-- post's company, and a guard trigger that derives it on write and refuses any value that disagrees with the post.
-- Version 20270217000030 reserved by the registry owner (83, registry ace9016d4); it replaces the retired
-- 20270217000026 because it must sort AFTER 20270217000028, which creates scheduled_posts.company_id.
--
-- WHY. content_analytics reaches its tenant only through scheduled_post_id (NOT NULL, FK -> scheduled_posts ON DELETE
-- CASCADE): it has no campaign or company column. After 028 every post carries its company, so each analytics row's
-- company is exactly its post's. A direct column lets the tenant seam (S2) key analytics reads (dashboards, community
-- AI, growth intelligence) on the company instead of walking through the post.
--
-- WHAT THIS DOES.
--   1. Preflight: 028 is applied (scheduled_posts.company_id NOT NULL); a pre-existing content_analytics.company_id
--      WITHOUT this migration's guard function is refused (provenance); any row whose post has no company is listed
--      and the migration RAISEs (none can exist after 028, which makes the post column NOT NULL).
--   2. ADD COLUMN; backfill from the post; assert no NULL remains.
--   3. FK -> companies(id) ON DELETE RESTRICT (posts already restrict a company delete, 028/029); index.
--   4. Guard trigger (SECURITY INVOKER, search_path ''), BEFORE INSERT, and BEFORE UPDATE only when scheduled_post_id
--      or company_id changes: derive company_id from the post when NULL; refuse (23514) a company that disagrees
--      with the post; refuse (23503) a post that does not exist.
--   5. SET NOT NULL; $verify$.
-- NOT re-checked: a later change of scheduled_posts.company_id (028's guard only lets it change consistently with the
-- post's campaign/account; analytics rows would then disagree. A post's company moving is not a supported operation).
--
-- ORDER. Apply AFTER 20270217000028 and 20270217000029: 025 -> 028 -> 029 -> 030.
-- GRANTS. No table grant changes. The guard function's EXECUTE is revoked from PUBLIC, anon and authenticated.
-- Rollback: supabase/migrations/rollbacks/content_analytics_company_id_rollback.sql (drops only what this created;
--   the column is fully re-derivable from the post).
-- Behavioural proof (CI): backend/tests/realschema/content_analytics_company_id.test.ts.

BEGIN;

DO $preflight$
DECLARE
  v_ids text;
BEGIN
  IF to_regclass('public.content_analytics') IS NULL OR to_regclass('public.scheduled_posts') IS NULL
     OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'CA-COMPANY preflight: a required table is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass
                  AND attname = 'company_id' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CA-COMPANY preflight: scheduled_posts.company_id is not NOT NULL; apply 20270217000028 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.content_analytics'::regclass
              AND attname = 'company_id' AND NOT attisdropped)
     AND to_regprocedure('public.content_analytics_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'CA-COMPANY preflight: content_analytics.company_id already exists but was not created by this migration (no guard function); refusing to adopt it';
  END IF;
  IF to_regclass('public.idx_content_analytics_company_id') IS NOT NULL
     AND to_regprocedure('public.content_analytics_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'CA-COMPANY preflight: index idx_content_analytics_company_id already exists but was not created by this migration; refusing to adopt it';
  END IF;

  SELECT string_agg(ca.id::text, ', ' ORDER BY ca.id) INTO v_ids
    FROM public.content_analytics ca
    LEFT JOIN public.scheduled_posts sp ON sp.id = ca.scheduled_post_id
   WHERE sp.company_id IS NULL;
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'CA-COMPANY preflight: analytics rows whose post has no company (or no post): %', v_ids;
  END IF;
END
$preflight$;

ALTER TABLE public.content_analytics ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE public.content_analytics ca
   SET company_id = sp.company_id
  FROM public.scheduled_posts sp
 WHERE sp.id = ca.scheduled_post_id AND ca.company_id IS NULL;

DO $backfilled$
DECLARE
  v_ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO v_ids FROM public.content_analytics WHERE company_id IS NULL;
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'CA-COMPANY backfill: rows still without a company (no NULL is ever kept): %', v_ids;
  END IF;
END
$backfilled$;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.content_analytics'::regclass AND conname = 'content_analytics_company_id_fkey') THEN
    ALTER TABLE public.content_analytics
      ADD CONSTRAINT content_analytics_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_content_analytics_company_id ON public.content_analytics USING btree (company_id);

CREATE OR REPLACE FUNCTION public.content_analytics_company_id_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_post_company uuid;
BEGIN
  SELECT sp.company_id INTO v_post_company FROM public.scheduled_posts sp WHERE sp.id = NEW.scheduled_post_id;
  IF NOT FOUND OR v_post_company IS NULL THEN
    RAISE EXCEPTION 'content_analytics: scheduled post % does not exist or has no company', NEW.scheduled_post_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.company_id IS NULL THEN
    NEW.company_id := v_post_company;
  ELSIF NEW.company_id <> v_post_company THEN
    RAISE EXCEPTION 'content_analytics: company % does not match the company % of post %',
      NEW.company_id, v_post_company, NEW.scheduled_post_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.content_analytics_company_id_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS content_analytics_company_id_guard_ins ON public.content_analytics;
CREATE TRIGGER content_analytics_company_id_guard_ins
  BEFORE INSERT ON public.content_analytics
  FOR EACH ROW EXECUTE FUNCTION public.content_analytics_company_id_guard();

DROP TRIGGER IF EXISTS content_analytics_company_id_guard_upd ON public.content_analytics;
CREATE TRIGGER content_analytics_company_id_guard_upd
  BEFORE UPDATE ON public.content_analytics
  FOR EACH ROW
  WHEN (OLD.scheduled_post_id IS DISTINCT FROM NEW.scheduled_post_id OR OLD.company_id IS DISTINCT FROM NEW.company_id)
  EXECUTE FUNCTION public.content_analytics_company_id_guard();

ALTER TABLE public.content_analytics ALTER COLUMN company_id SET NOT NULL;

DO $verify$
DECLARE
  v_n int;
  v_fn oid := 'public.content_analytics_company_id_guard()'::regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.content_analytics'::regclass
                  AND attname = 'company_id' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CA-COMPANY verify: content_analytics.company_id is not NOT NULL';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = 'public.content_analytics'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.companies'::regclass AND c.confdeltype = 'r'
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.content_analytics'::regclass AND attname = 'company_id')]::int2[];
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CA-COMPANY verify: expected one FK content_analytics(company_id) -> companies(id) ON DELETE RESTRICT, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.content_analytics'::regclass AND tgfoid = v_fn AND tgenabled = 'O'
     AND tgname IN ('content_analytics_company_id_guard_ins', 'content_analytics_company_id_guard_upd');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CA-COMPANY verify: expected 2 enabled guard triggers, found %', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef) THEN
    RAISE EXCEPTION 'CA-COMPANY verify: guard function must be SECURITY INVOKER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND proconfig @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'CA-COMPANY verify: guard function must SET search_path to empty';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'CA-COMPANY verify: guard function is executable by PUBLIC/anon/authenticated';
  END IF;
  SELECT count(*) INTO v_n FROM public.content_analytics ca
    JOIN public.scheduled_posts sp ON sp.id = ca.scheduled_post_id
   WHERE ca.company_id <> sp.company_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CA-COMPANY verify: % analytics rows disagree with their post''s company', v_n;
  END IF;
END
$verify$;

COMMIT;
