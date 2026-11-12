-- scheduled_posts gains company_id (NOT NULL, FK -> companies ON DELETE RESTRICT), backfilled from its
-- three populations, and a trigger that derives it on write and REFUSES a post whose campaign and
-- social account belong to different companies. Version 20270217000028 reserved by the registry
-- owner (83). Design approved by e9, 2026-11-13.
--
-- WHY. scheduled_posts had no company column. A post's company was inferred at read time from its
-- campaign or its social account, and a live defect (fixed on fix/schedule-social-account-company-
-- 20261113) attached a post to ANOTHER company's social account, publishing company A's post through
-- company B's account. The tenant seam (S2) also needs a column to key on: campaign-less posts are
-- unreachable through the campaign parent. This makes the company explicit and the defect class
-- impossible at the database level.
--
-- THE THREE POPULATIONS (each backfilled from one source; any row that cannot be derived honestly
-- makes the preflight RAISE, listing ids; a NULL company is never written):
--   (a) campaign-linked (campaign_id set): the CAMPAIGN's company. RAISE if the campaign is missing,
--       if its company is NULL, or if the post's social account belongs to a different company
--       (NULL account company included: unknown tenancy is not "the same company").
--   (b) standalone with an account: the ACCOUNT's company. RAISE if it is NULL, or if the creator
--       (user_id) has no membership row at all in that company (ANY status: membership as of posting).
--   (c) standalone without an account: the creator's company ONLY if they have exactly one ACTIVE
--       membership. RAISE otherwise (zero or several).
--
-- THE TRIGGER (scheduled_posts_company_id_guard, SECURITY INVOKER, search_path ''):
--   BEFORE INSERT, and BEFORE UPDATE only when campaign_id / social_account_id / company_id actually
--   change (a WHEN clause, so unrelated updates such as status writes never fire it).
--   - campaign company and account company both known and different -> RAISE 23514;
--   - an account with company NULL on a campaign post -> RAISE 23514 (unknown tenancy);
--   - campaign_id names no campaign -> RAISE 23503;
--   - company_id NULL -> derived (campaign, else account); still NULL -> RAISE 23502 with a message;
--   - company_id given but different from the derived company -> RAISE 23514.
--   Insert paths that do not write company_id keep working: the trigger fills it.
--   NOT re-checked: a later change of campaigns.company_id or social_accounts.company_id (no trigger
--   on those tables; campaigns.company_id is NOT NULL + RESTRICT since 025).
--
-- ORDER. Apply AFTER 20270217000025 (campaigns.company_id NOT NULL) and BEFORE any S2 conversion of
-- scheduled_posts goes live. The fast-track code (resolver) should be deployed first so no new
-- cross-company row is written between 83's counts and this apply; the preflight refuses one anyway.
--
-- GRANTS. No table grant changes. The trigger function's EXECUTE is revoked from PUBLIC, anon and
-- authenticated (a new function's proacl NULL means EXECUTE for PUBLIC).
-- Postcondition ($verify$): attnotnull; exactly one FK scheduled_posts(company_id) -> companies(id)
-- ON DELETE RESTRICT; both triggers present and enabled; function SECURITY INVOKER with
-- search_path=''; no EXECUTE for PUBLIC/anon/authenticated; no row with a campaign/account mismatch.
-- Rollback: supabase/migrations/rollbacks/scheduled_posts_company_id_rollback.sql.
-- Behavioural proof (CI): backend/tests/realschema/scheduled_posts_company_id.test.ts.

BEGIN;

DO $preflight$
DECLARE
  v_ids text;
BEGIN
  IF to_regclass('public.scheduled_posts') IS NULL OR to_regclass('public.campaigns') IS NULL
     OR to_regclass('public.social_accounts') IS NULL OR to_regclass('public.user_company_roles') IS NULL
     OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'SP-COMPANY preflight: a required table is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.campaigns'::regclass
                  AND attname = 'company_id' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'SP-COMPANY preflight: campaigns.company_id is not NOT NULL; apply 20270217000025 first';
  END IF;

  -- Re-apply: if the column already exists, only rows still NULL are examined below.
  -- (a) campaign-linked
  SELECT string_agg(sp.id::text, ', ' ORDER BY sp.id) INTO v_ids
    FROM public.scheduled_posts sp
   WHERE sp.campaign_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = sp.campaign_id);
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'SP-COMPANY preflight (a): posts name a campaign that does not exist: %', v_ids;
  END IF;
  SELECT string_agg(sp.id::text, ', ' ORDER BY sp.id) INTO v_ids
    FROM public.scheduled_posts sp
    JOIN public.campaigns c ON c.id = sp.campaign_id
    JOIN public.social_accounts sa ON sa.id = sp.social_account_id
   WHERE sa.company_id IS DISTINCT FROM c.company_id;
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'SP-COMPANY preflight (a): posts whose social account is not in their campaign''s company: %', v_ids;
  END IF;

  -- (b) standalone with an account
  SELECT string_agg(sp.id::text, ', ' ORDER BY sp.id) INTO v_ids
    FROM public.scheduled_posts sp
    JOIN public.social_accounts sa ON sa.id = sp.social_account_id
   WHERE sp.campaign_id IS NULL AND sa.company_id IS NULL;
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'SP-COMPANY preflight (b): standalone posts whose account has no company: %', v_ids;
  END IF;
  SELECT string_agg(sp.id::text, ', ' ORDER BY sp.id) INTO v_ids
    FROM public.scheduled_posts sp
    JOIN public.social_accounts sa ON sa.id = sp.social_account_id
   WHERE sp.campaign_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_company_roles r
                      WHERE r.user_id = sp.user_id AND r.company_id = sa.company_id);
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'SP-COMPANY preflight (b): standalone posts whose account company is not one their creator belongs to: %', v_ids;
  END IF;

  -- (c) standalone without an account
  SELECT string_agg(sp.id::text, ', ' ORDER BY sp.id) INTO v_ids
    FROM public.scheduled_posts sp
   WHERE sp.campaign_id IS NULL AND sp.social_account_id IS NULL
     AND (SELECT count(DISTINCT r.company_id) FROM public.user_company_roles r
           WHERE r.user_id = sp.user_id AND r.status = 'active') <> 1;
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'SP-COMPANY preflight (c): standalone posts with no account whose creator does not have exactly one active company: %', v_ids;
  END IF;
END
$preflight$;

ALTER TABLE public.scheduled_posts ADD COLUMN IF NOT EXISTS company_id uuid;

-- Backfill, one population at a time; never writes NULL (each source was proven non-NULL above).
UPDATE public.scheduled_posts sp
   SET company_id = c.company_id
  FROM public.campaigns c
 WHERE c.id = sp.campaign_id AND sp.company_id IS NULL;

UPDATE public.scheduled_posts sp
   SET company_id = sa.company_id
  FROM public.social_accounts sa
 WHERE sa.id = sp.social_account_id AND sp.campaign_id IS NULL AND sp.company_id IS NULL;

UPDATE public.scheduled_posts sp
   SET company_id = m.company_id
  FROM (SELECT r.user_id, min(r.company_id::text)::uuid AS company_id
          FROM public.user_company_roles r
         WHERE r.status = 'active'
         GROUP BY r.user_id
        HAVING count(DISTINCT r.company_id) = 1) m
 WHERE m.user_id = sp.user_id
   AND sp.campaign_id IS NULL AND sp.social_account_id IS NULL AND sp.company_id IS NULL;

DO $backfilled$
DECLARE
  v_ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO v_ids FROM public.scheduled_posts WHERE company_id IS NULL;
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'SP-COMPANY backfill: rows still without a company (no NULL is ever kept): %', v_ids;
  END IF;
END
$backfilled$;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.scheduled_posts'::regclass AND conname = 'scheduled_posts_company_id_fkey') THEN
    ALTER TABLE public.scheduled_posts
      ADD CONSTRAINT scheduled_posts_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_company_id ON public.scheduled_posts USING btree (company_id);

CREATE OR REPLACE FUNCTION public.scheduled_posts_company_id_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_campaign_company uuid;
  v_account_company uuid;
  v_derived uuid;
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    SELECT c.company_id INTO v_campaign_company FROM public.campaigns c WHERE c.id = NEW.campaign_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'scheduled_posts: campaign % does not exist', NEW.campaign_id USING ERRCODE = '23503';
    END IF;
  END IF;

  IF NEW.social_account_id IS NOT NULL THEN
    SELECT sa.company_id INTO v_account_company FROM public.social_accounts sa WHERE sa.id = NEW.social_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'scheduled_posts: social account % does not exist', NEW.social_account_id USING ERRCODE = '23503';
    END IF;
  END IF;

  IF NEW.campaign_id IS NOT NULL AND NEW.social_account_id IS NOT NULL
     AND v_account_company IS DISTINCT FROM v_campaign_company THEN
    RAISE EXCEPTION 'scheduled_posts: social account % (company %) is not in campaign %''s company %',
      NEW.social_account_id, coalesce(v_account_company::text, 'none'), NEW.campaign_id, v_campaign_company
      USING ERRCODE = '23514';
  END IF;

  v_derived := coalesce(v_campaign_company, v_account_company);

  IF NEW.company_id IS NULL THEN
    NEW.company_id := v_derived;
  ELSIF v_derived IS NOT NULL AND NEW.company_id <> v_derived THEN
    RAISE EXCEPTION 'scheduled_posts: company % does not match the company % of its campaign/account',
      NEW.company_id, v_derived USING ERRCODE = '23514';
  END IF;

  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'scheduled_posts: no company can be derived (no campaign, and no account with a company); pass company_id'
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.scheduled_posts_company_id_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS scheduled_posts_company_id_guard_ins ON public.scheduled_posts;
CREATE TRIGGER scheduled_posts_company_id_guard_ins
  BEFORE INSERT ON public.scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_posts_company_id_guard();

DROP TRIGGER IF EXISTS scheduled_posts_company_id_guard_upd ON public.scheduled_posts;
CREATE TRIGGER scheduled_posts_company_id_guard_upd
  BEFORE UPDATE ON public.scheduled_posts
  FOR EACH ROW
  WHEN (OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
     OR OLD.social_account_id IS DISTINCT FROM NEW.social_account_id
     OR OLD.company_id IS DISTINCT FROM NEW.company_id)
  EXECUTE FUNCTION public.scheduled_posts_company_id_guard();

ALTER TABLE public.scheduled_posts ALTER COLUMN company_id SET NOT NULL;

DO $verify$
DECLARE
  v_n int;
  v_fn oid := 'public.scheduled_posts_company_id_guard()'::regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass
                  AND attname = 'company_id' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'SP-COMPANY verify: scheduled_posts.company_id is not NOT NULL';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = 'public.scheduled_posts'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.companies'::regclass AND c.confdeltype = 'r'
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass AND attname = 'company_id')]::int2[];
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'SP-COMPANY verify: expected one FK scheduled_posts(company_id) -> companies(id) ON DELETE RESTRICT, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.scheduled_posts'::regclass AND tgfoid = v_fn AND tgenabled = 'O'
     AND tgname IN ('scheduled_posts_company_id_guard_ins', 'scheduled_posts_company_id_guard_upd');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'SP-COMPANY verify: expected 2 enabled guard triggers, found %', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef) THEN
    RAISE EXCEPTION 'SP-COMPANY verify: guard function must be SECURITY INVOKER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND proconfig @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'SP-COMPANY verify: guard function must SET search_path to empty';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'SP-COMPANY verify: guard function is executable by PUBLIC/anon/authenticated';
  END IF;
  SELECT count(*) INTO v_n FROM public.scheduled_posts sp
    JOIN public.campaigns c ON c.id = sp.campaign_id
   WHERE sp.company_id <> c.company_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SP-COMPANY verify: % posts disagree with their campaign''s company', v_n;
  END IF;
END
$verify$;

COMMIT;
