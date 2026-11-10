-- 20270210000000_action_pricing_versioned_apply
--
-- Billing defect B-1 (found by virality-e1; confirmed in production by catalogue query C1, 2026-11-10;
-- owner approved the fix via virality-e9). Reserved by Release-controls (virality-83).
--
-- THE DEFECT. Both admin writers of action_pricing_config (actionPricingApplyService.applyActionPricingChange
-- and pages/api/admin/pricing/update.ts) ran two separately committed PostgREST statements:
--   1. UPDATE ... SET is_active = false WHERE action_key = X AND is_active
--   2. INSERT ... (no source_type)
-- In production source_type is `text NOT NULL` with no default, domain, trigger or rule (C1), so step 2
-- always fails -- AFTER step 1 has committed. The action is left with no active row and
-- pricingService.fetchActionPricingRow then throws for every lookup of it. C2 (2026-11-10) shows this has
-- never happened: the write path has never run in production (all 31 rows are the 2026-04-22 seed).
--
-- THE FIX. One function, one statement from the caller, so one transaction:
--   * SELECT ... FOR UPDATE on the action's active row(s): concurrent edits of the same action serialise
--     instead of racing (correct whether or not the partial unique index on (action_key) WHERE is_active
--     exists; the production baseline has two identical ones);
--   * source_type is CARRIED from the prior active row, or must be supplied; with neither, a NAMED refusal
--     (22023), never a NOT NULL violation;
--   * deactivate-then-insert, scoped to THIS action_key only; the order is required by the unique index and
--     harmless without it, because no reader observes the intermediate state inside one transaction;
--   * source_type vocabulary is NOT duplicated here: the table's CHECK is the single authority (a value it
--     rejects raises 23514 and the whole transaction, including the deactivate, rolls back). So a later
--     widening of that CHECK (e.g. virality-e1's 'vendor_unit') cannot drift from this function.
--
-- SECURITY INVOKER (service_role, which bypasses RLS, is the only caller). EXECUTE is revoked from PUBLIC,
-- anon and authenticated by name (a function's NULL proacl means EXECUTE to PUBLIC) and granted to
-- service_role. search_path is pinned; a postcondition requires proconfig to be EXACTLY that pin, because a
-- later CREATE OR REPLACE without the SET clause would silently drop it on a privileged write path.
--
-- Additive: no table, column, constraint or index changes. Rollback:
--   supabase/migrations/rollbacks/action_pricing_versioned_apply_rollback.sql
-- (deploy order: this migration BEFORE the code that calls it; roll back the code BEFORE this.)

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_action_pricing_change(
  p_action_key         text,
  p_cost_multiplier    numeric,
  p_minimum_charge_usd numeric,
  p_ceiling_usd        numeric,
  p_effective_from     timestamptz,
  p_notes              text,
  p_source_type        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prior_source text;
  v_source       text;
  v_id           uuid;
BEGIN
  IF p_action_key IS NULL OR btrim(p_action_key) = '' THEN
    RAISE EXCEPTION 'apply_action_pricing_change: action_key is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_cost_multiplier IS NULL THEN
    RAISE EXCEPTION 'apply_action_pricing_change: cost_multiplier is required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent edits of this action (locks its current active row, if any).
  PERFORM 1
     FROM public.action_pricing_config
    WHERE action_key = p_action_key
      AND is_active
      FOR UPDATE;

  SELECT apc.source_type
    INTO v_prior_source
    FROM public.action_pricing_config apc
   WHERE apc.action_key = p_action_key
     AND apc.is_active
   ORDER BY apc.effective_from DESC
   LIMIT 1;

  v_source := COALESCE(NULLIF(btrim(p_source_type), ''), v_prior_source);
  IF v_source IS NULL THEN
    RAISE EXCEPTION 'apply_action_pricing_change: source_type is required for action_key % (it has no active row to carry it from)', p_action_key
      USING ERRCODE = '22023';
  END IF;

  -- Scoped to THIS action only: an unscoped predicate would deactivate every action's pricing.
  UPDATE public.action_pricing_config
     SET is_active = false,
         updated_at = now()
   WHERE action_key = p_action_key
     AND is_active;

  INSERT INTO public.action_pricing_config (
    action_key, cost_multiplier, minimum_charge_usd, ceiling_usd,
    effective_from, is_active, notes, source_type
  ) VALUES (
    p_action_key, p_cost_multiplier, COALESCE(p_minimum_charge_usd, 0), p_ceiling_usd,
    COALESCE(p_effective_from, now()), true, p_notes, v_source
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

COMMENT ON FUNCTION public.apply_action_pricing_change(text, numeric, numeric, numeric, timestamptz, text, text) IS
  'THE versioned write for action_pricing_config (billing defect B-1). Locks the action''s active row, carries source_type from it (or requires it), deactivates that action''s active row and inserts the new active row in ONE transaction. The table CHECK is the only source_type vocabulary. service_role only.';

REVOKE ALL ON FUNCTION public.apply_action_pricing_change(text, numeric, numeric, numeric, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_action_pricing_change(text, numeric, numeric, numeric, timestamptz, text, text)
  TO service_role;

-- Postconditions. Each RAISEs and names its trigger.
DO $$
DECLARE
  v_sig  regprocedure := 'public.apply_action_pricing_change(text, numeric, numeric, numeric, timestamptz, text, text)'::regprocedure;
  v_role text;
  v_def  boolean;
  v_cfg  text[];
BEGIN
  -- P1: no client role may execute it (trigger: the REVOKE line removed, or a later GRANT to a client role).
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondition P1 failed: % can EXECUTE apply_action_pricing_change', v_role;
    END IF;
  END LOOP;
  -- P2: service_role must execute it (trigger: the GRANT line removed).
  IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition P2 failed: service_role cannot EXECUTE apply_action_pricing_change';
  END IF;
  -- P3: SECURITY INVOKER (trigger: SECURITY DEFINER).
  -- P4: search_path pinned EXACTLY (trigger: the SET clause removed or altered).
  SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg FROM pg_proc p WHERE p.oid = v_sig;
  IF v_def THEN
    RAISE EXCEPTION 'postcondition P3 failed: apply_action_pricing_change is SECURITY DEFINER';
  END IF;
  IF v_cfg IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'postcondition P4 failed: apply_action_pricing_change proconfig is %, expected {search_path=pg_catalog, public}', v_cfg;
  END IF;
END
$$;

COMMIT;
