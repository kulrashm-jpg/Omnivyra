-- campaigns.company_id becomes NOT NULL, and its FK ON DELETE RESTRICT (owner ruling, option A, via
-- e9, 2026-11-13). Version 20270217000025 reserved by the registry owner (83, 248f4ffd3).
--
-- WHY. In prod, 7 of 28 campaigns had company_id NULL (83 C28/C29): nine live code paths inserted a
-- campaign without its company (fixed on fix/campaign-insert-company-id-20261112), and the column
-- was nullable with no trigger to fill it. A company-less campaign is invisible to company-scoped
-- reads, and the tenant seam (S2) keys on this column. NOT NULL makes the defect class impossible.
--
-- WHY RESTRICT. The FK was ON DELETE SET NULL, which contradicts NOT NULL: deleting a company would
-- try to write NULL and fail with 23502. RESTRICT makes that refusal explicit and atomic (23503).
-- The live public.hard_delete_company (83, C26: md5(prosrc) 632ddc62639822a7bfe5a4c85d114f0e,
-- identical to 20261210000001's body) never touches campaigns, so after this a company that still
-- has campaigns cannot be hard-deleted: the whole function aborts (23503) and nothing is deleted.
-- That is the intended behaviour under option A (a company's campaigns are dealt with explicitly
-- first, never deleted or orphaned as a side effect).
--
-- ORDER. Apply only AFTER the owner's data step (83's D3, done in prod 2026-11-13: the 2 seed
-- campaigns deleted, the 5 real ones reattached). The preflight REFUSES while any NULL remains, so
-- it can never run against data it would reject half-way.
--
-- WHAT THIS DOES. (1) ALTER COLUMN company_id SET NOT NULL; (2) replaces the FK
-- campaigns_company_id_fkey with the same columns and target, ON DELETE RESTRICT (ON UPDATE
-- unchanged). WHAT THIS DOES NOT DO. No data is touched; no other constraint, index, policy, grant or
-- function changes.
--
-- Preflight: the column exists; no NULL remains; the FK exists exactly as expected (single column,
-- -> public.companies(id), ON DELETE SET NULL or already RESTRICT, so a re-apply is a no-op).
-- Postcondition ($verify$): attnotnull, and exactly one FK on campaigns(company_id) ->
-- companies(id) with confdeltype 'r'.
-- Rollback: supabase/migrations/rollbacks/campaigns_company_id_not_null_rollback.sql (restores
--   ON DELETE SET NULL and drops NOT NULL).
-- Behavioural proof (CI): backend/tests/realschema/campaigns_company_id_not_null.test.ts.

BEGIN;

DO $preflight$
DECLARE
  v_nulls bigint;
  v_fk record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.campaigns'::regclass
       AND a.attname = 'company_id' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN preflight: public.campaigns.company_id not found';
  END IF;

  SELECT count(*) INTO v_nulls FROM public.campaigns WHERE company_id IS NULL;
  IF v_nulls > 0 THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN preflight: % campaign(s) still have company_id NULL; run the owner data step (reattach or remove) first', v_nulls;
  END IF;

  SELECT c.conname, c.confdeltype, c.conkey, c.confrelid,
         (SELECT array_agg(att.attname ORDER BY att.attnum) FROM pg_attribute att
           WHERE att.attrelid = c.confrelid AND att.attnum = ANY (c.confkey)) AS ref_cols
    INTO v_fk
    FROM pg_constraint c
   WHERE c.conrelid = 'public.campaigns'::regclass
     AND c.contype = 'f'
     AND c.conname = 'campaigns_company_id_fkey';
  IF v_fk.conname IS NULL THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN preflight: FK public.campaigns.campaigns_company_id_fkey not found';
  END IF;
  IF v_fk.confrelid <> 'public.companies'::regclass OR v_fk.ref_cols <> ARRAY['id']::name[]
     OR array_length(v_fk.conkey, 1) <> 1 THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN preflight: campaigns_company_id_fkey is not campaigns(company_id) -> companies(id)';
  END IF;
  IF v_fk.confdeltype NOT IN ('n', 'r') THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN preflight: campaigns_company_id_fkey ON DELETE is %, expected SET NULL (n) or already RESTRICT (r)', v_fk.confdeltype;
  END IF;
END
$preflight$;

ALTER TABLE public.campaigns ALTER COLUMN company_id SET NOT NULL;

-- Replace the FK only when it is not RESTRICT yet (a re-apply leaves it untouched).
DO $fk$
DECLARE
  v_deltype "char";
  v_updtype "char";
  v_on_update text;
BEGIN
  SELECT confdeltype, confupdtype INTO v_deltype, v_updtype
    FROM pg_constraint
   WHERE conrelid = 'public.campaigns'::regclass AND conname = 'campaigns_company_id_fkey';
  IF v_deltype = 'r' THEN
    RETURN;
  END IF;
  v_on_update := CASE v_updtype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END;
  ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_company_id_fkey;
  EXECUTE format(
    'ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE %s ON DELETE RESTRICT',
    v_on_update);
END
$fk$;

DO $verify$
DECLARE
  v_fks int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.campaigns'::regclass
       AND a.attname = 'company_id' AND NOT a.attisdropped AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN verify: public.campaigns.company_id is not NOT NULL';
  END IF;
  SELECT count(*) INTO v_fks
    FROM pg_constraint c
   WHERE c.conrelid = 'public.campaigns'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.companies'::regclass
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.campaigns'::regclass AND attname = 'company_id')]::int2[];
  IF v_fks <> 1 THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN verify: expected exactly one FK campaigns(company_id) -> companies(id), found %', v_fks;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.campaigns'::regclass AND conname = 'campaigns_company_id_fkey'
       AND contype = 'f' AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN verify: campaigns_company_id_fkey is not ON DELETE RESTRICT';
  END IF;
END
$verify$;

COMMIT;
