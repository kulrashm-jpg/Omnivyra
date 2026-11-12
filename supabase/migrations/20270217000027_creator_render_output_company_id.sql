-- creator_render_output gains company_id (NOT NULL, FK -> companies ON DELETE RESTRICT), backfilled through its
-- lineage, and a guard trigger that derives it on write and refuses any value that disagrees with the lineage.
-- Version 20270217000027 reserved by the registry owner (83).
--
-- WHY. creator_render_output reaches its tenant only through three hops:
--   output.attempt_id -> creator_render_attempt.variant_id -> creator_render_variant.render_job_id
--   -> creator_render_job.organization_id
-- Every hop is NOT NULL with an ON DELETE RESTRICT foreign key, so every row is derivable and no parent can vanish
-- under it. The tenant seam (S2) currently reaches outputs as a CHILD of creator_render_attempt (one hop, then the
-- seam walks the rest); a direct column makes the tenant explicit for the money-adjacent render path and lets the
-- registry key on it.
--
-- WHAT THIS DOES.
--   1. Preflight: the four tables and the lineage columns exist; a pre-existing creator_render_output.company_id
--      WITHOUT this migration's guard function is refused (provenance: never adopt a column it did not create);
--      any existing output row without a company makes it RAISE (append-only ledger, see LEDGER).
--   2. ADD COLUMN company_id uuid (no backfill: the ledger has no rows to fill, proven by the preflight).
--   3. FK -> companies(id) ON DELETE RESTRICT; index.
--   4. Guard trigger (SECURITY INVOKER, search_path ''), BEFORE INSERT, and BEFORE UPDATE only when attempt_id or
--      company_id actually changes: derive company_id from the lineage when NULL; refuse (23514) a company_id that
--      disagrees with the lineage; refuse (23503) a lineage that does not resolve.
--   5. SET NOT NULL; $verify$ postcondition.
-- LEDGER. creator_render_output is APPEND-ONLY (creator_render_output_immutable_update / _delete ->
-- raise_ledger_immutable, 20260663). Existing rows therefore cannot be backfilled in place without disabling an audit
-- control, which this migration will not do on its own authority: the preflight REFUSES while any output row exists
-- (prod: render flags are off; 83 to count) and names the count, so a backfill can only happen under an explicit
-- ruling. New rows get company_id from the guard trigger at INSERT; an UPDATE of a ledger row is refused by the
-- immutability trigger anyway (the UPDATE guard here is defence in depth for a future relaxation).
-- NOT re-checked: a later change of creator_render_job.organization_id (that table is append-only as well).
--
-- ORDER. Independent of 20270217000028/29. Apply BEFORE the registry moves creator_render_output from
-- VIA creator_render_attempt to a direct company_id column (S2).
-- GRANTS. No table grant changes. The guard function's EXECUTE is revoked from PUBLIC, anon and authenticated
-- (a new function's proacl NULL means EXECUTE for PUBLIC).
-- Rollback: supabase/migrations/rollbacks/creator_render_output_company_id_rollback.sql (drops only what this
--   created; the column is fully re-derivable from the lineage, so nothing is lost).
-- Behavioural proof (CI): backend/tests/realschema/creator_render_output_company_id.test.ts.

BEGIN;

DO $preflight$
DECLARE
  v_ids text;
  v_n bigint;
BEGIN
  IF to_regclass('public.creator_render_output') IS NULL OR to_regclass('public.creator_render_attempt') IS NULL
     OR to_regclass('public.creator_render_variant') IS NULL OR to_regclass('public.creator_render_job') IS NULL
     OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'CRO-COMPANY preflight: a required table is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.creator_render_job'::regclass
                  AND attname = 'organization_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CRO-COMPANY preflight: creator_render_job.organization_id not found';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.creator_render_output'::regclass
              AND attname = 'company_id' AND NOT attisdropped)
     AND to_regprocedure('public.creator_render_output_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'CRO-COMPANY preflight: creator_render_output.company_id already exists but was not created by this migration (no guard function); refusing to adopt it';
  END IF;
  IF to_regclass('public.idx_creator_render_output_company_id') IS NOT NULL
     AND to_regprocedure('public.creator_render_output_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'CRO-COMPANY preflight: index idx_creator_render_output_company_id already exists but was not created by this migration; refusing to adopt it';
  END IF;

  -- Ledger rows cannot be updated (see LEDGER above). On a re-apply every row already carries company_id.
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.creator_render_output'::regclass
              AND attname = 'company_id' AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM public.creator_render_output WHERE company_id IS NULL' INTO v_n;
  ELSE
    SELECT count(*) INTO v_n FROM public.creator_render_output;
  END IF;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CRO-COMPANY preflight: % existing render output row(s) have no company_id; creator_render_output is an append-only ledger (raise_ledger_immutable), so they cannot be backfilled in place without a ruled exception', v_n;
  END IF;
END
$preflight$;

ALTER TABLE public.creator_render_output ADD COLUMN IF NOT EXISTS company_id uuid;

-- No backfill: the preflight proved there is no row without a company (see LEDGER).

DO $backfilled$
DECLARE
  v_ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO v_ids FROM public.creator_render_output WHERE company_id IS NULL;
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'CRO-COMPANY backfill: outputs still without a company (no NULL is ever kept): %', v_ids;
  END IF;
END
$backfilled$;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.creator_render_output'::regclass AND conname = 'creator_render_output_company_id_fkey') THEN
    ALTER TABLE public.creator_render_output
      ADD CONSTRAINT creator_render_output_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_creator_render_output_company_id ON public.creator_render_output USING btree (company_id);

CREATE OR REPLACE FUNCTION public.creator_render_output_company_id_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_lineage uuid;
BEGIN
  SELECT j.organization_id INTO v_lineage
    FROM public.creator_render_attempt a
    JOIN public.creator_render_variant v ON v.id = a.variant_id
    JOIN public.creator_render_job j ON j.id = v.render_job_id
   WHERE a.id = NEW.attempt_id;
  IF v_lineage IS NULL THEN
    RAISE EXCEPTION 'creator_render_output: attempt % does not resolve to a render job company', NEW.attempt_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.company_id IS NULL THEN
    NEW.company_id := v_lineage;
  ELSIF NEW.company_id <> v_lineage THEN
    RAISE EXCEPTION 'creator_render_output: company % does not match the company % of attempt %',
      NEW.company_id, v_lineage, NEW.attempt_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.creator_render_output_company_id_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS creator_render_output_company_id_guard_ins ON public.creator_render_output;
CREATE TRIGGER creator_render_output_company_id_guard_ins
  BEFORE INSERT ON public.creator_render_output
  FOR EACH ROW EXECUTE FUNCTION public.creator_render_output_company_id_guard();

DROP TRIGGER IF EXISTS creator_render_output_company_id_guard_upd ON public.creator_render_output;
CREATE TRIGGER creator_render_output_company_id_guard_upd
  BEFORE UPDATE ON public.creator_render_output
  FOR EACH ROW
  WHEN (OLD.attempt_id IS DISTINCT FROM NEW.attempt_id OR OLD.company_id IS DISTINCT FROM NEW.company_id)
  EXECUTE FUNCTION public.creator_render_output_company_id_guard();

ALTER TABLE public.creator_render_output ALTER COLUMN company_id SET NOT NULL;

DO $verify$
DECLARE
  v_n int;
  v_fn oid := 'public.creator_render_output_company_id_guard()'::regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.creator_render_output'::regclass
                  AND attname = 'company_id' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CRO-COMPANY verify: creator_render_output.company_id is not NOT NULL';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = 'public.creator_render_output'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.companies'::regclass AND c.confdeltype = 'r'
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.creator_render_output'::regclass AND attname = 'company_id')]::int2[];
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CRO-COMPANY verify: expected one FK creator_render_output(company_id) -> companies(id) ON DELETE RESTRICT, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.creator_render_output'::regclass AND tgfoid = v_fn AND tgenabled = 'O'
     AND tgname IN ('creator_render_output_company_id_guard_ins', 'creator_render_output_company_id_guard_upd');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CRO-COMPANY verify: expected 2 enabled guard triggers, found %', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef) THEN
    RAISE EXCEPTION 'CRO-COMPANY verify: guard function must be SECURITY INVOKER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND proconfig @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'CRO-COMPANY verify: guard function must SET search_path to empty';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'CRO-COMPANY verify: guard function is executable by PUBLIC/anon/authenticated';
  END IF;
  SELECT count(*) INTO v_n
    FROM public.creator_render_output o
    JOIN public.creator_render_attempt a ON a.id = o.attempt_id
    JOIN public.creator_render_variant v ON v.id = a.variant_id
    JOIN public.creator_render_job j ON j.id = v.render_job_id
   WHERE o.company_id <> j.organization_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CRO-COMPANY verify: % outputs disagree with their lineage company', v_n;
  END IF;
END
$verify$;

COMMIT;
