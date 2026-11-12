-- 20270210000001_model_pricing_versioned_apply
--
-- Follow-up to billing defect B-1 (20270210000000), approved by virality-e9 on 2026-11-10. It uses the SAME
-- design for llm_model_pricing, not a second one. Reserved by Release-controls (virality-83).
--
-- THE DEFECT. pages/api/admin/pricing/update.ts (target 'model') ran two separately committed PostgREST
-- statements: deactivate the (provider, model_name, kind) active row, then insert the new row. Unlike B-1 the
-- insert supplies every NOT NULL column, so it does not fail by construction. But:
--   * it is not atomic: any insert failure (a CHECK, a concurrent edit tripping uq_llm_model_pricing_active,
--     or a transport error) leaves the model with no active price, and pricingService then raises
--     PricingMissingError for it;
--   * it never wrote max_context_tokens / max_output_tokens, so EVERY model price edit silently wiped the
--     model's token limits (the new row had NULLs). In production (C1) the price columns are NOT NULL and the
--     token columns are nullable: the same omission is a LOUD failure for a price column and SILENT data
--     loss for a token column. That asymmetry, not subtler code, is why this hid while B-1 was discoverable.
--
-- THE FIX, mirroring apply_action_pricing_change:
--   * a transaction-scoped advisory lock on (provider, model_name, kind), plus SELECT ... FOR UPDATE on its
--     active row, so concurrent edits serialise even when no active row exists;
--   * max_context_tokens / max_output_tokens are CARRIED from the prior active row unless supplied;
--   * deactivate-then-insert, scoped to THIS (provider, model_name, kind) only, in one transaction. The order
--     is required by uq_llm_model_pricing_active (provider, model_name, kind) WHERE is_active, and is harmless
--     without it;
--   * the kind vocabulary is NOT duplicated: llm_model_pricing_kind_check is the single authority, so a later
--     widening (e.g. virality-e1's 'unit') cannot drift from this function.
-- SECURITY INVOKER; EXECUTE revoked from PUBLIC, anon and authenticated by name and granted to service_role;
-- search_path pinned to `pg_catalog, public, pg_temp` (pg_temp LAST), and a postcondition requires proconfig
-- to be EXACTLY that pin.
--
-- Additive: no table, column, constraint or index changes. Rollback:
--   supabase/migrations/rollbacks/model_pricing_versioned_apply_rollback.sql
-- (deploy order: this migration BEFORE the code that calls it; roll back the code BEFORE this.)

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_model_pricing_change(
  p_provider           text,
  p_model_name         text,
  p_kind               text,
  p_input_per_1k_usd   numeric,
  p_output_per_1k_usd  numeric,
  p_effective_from     timestamptz,
  p_notes              text,
  p_max_context_tokens integer DEFAULT NULL,
  p_max_output_tokens  integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_prior_ctx integer;
  v_prior_out integer;
  v_id        uuid;
BEGIN
  IF p_provider IS NULL OR btrim(p_provider) = '' OR p_model_name IS NULL OR btrim(p_model_name) = '' THEN
    RAISE EXCEPTION 'apply_model_pricing_change: provider and model_name are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR btrim(p_kind) = '' THEN
    RAISE EXCEPTION 'apply_model_pricing_change: kind is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_input_per_1k_usd IS NULL OR p_output_per_1k_usd IS NULL THEN
    RAISE EXCEPTION 'apply_model_pricing_change: input_per_1k_usd and output_per_1k_usd are required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent edits of this (provider, model, kind). The advisory lock covers the empty case,
  -- where FOR UPDATE locks nothing, independently of uq_llm_model_pricing_active (unverified in production).
  PERFORM pg_advisory_xact_lock(hashtext('model_pricing:' || p_provider || '|' || p_model_name || '|' || p_kind));
  PERFORM 1
     FROM public.llm_model_pricing
    WHERE provider = p_provider
      AND model_name = p_model_name
      AND kind = p_kind
      AND is_active
      FOR UPDATE;

  SELECT m.max_context_tokens, m.max_output_tokens
    INTO v_prior_ctx, v_prior_out
    FROM public.llm_model_pricing m
   WHERE m.provider = p_provider
     AND m.model_name = p_model_name
     AND m.kind = p_kind
     AND m.is_active
   ORDER BY m.effective_from DESC
   LIMIT 1;

  -- Scoped to THIS (provider, model_name, kind) only.
  UPDATE public.llm_model_pricing
     SET is_active = false
   WHERE provider = p_provider
     AND model_name = p_model_name
     AND kind = p_kind
     AND is_active;

  INSERT INTO public.llm_model_pricing (
    provider, model_name, kind, input_per_1k_usd, output_per_1k_usd,
    effective_from, is_active, notes, max_context_tokens, max_output_tokens
  ) VALUES (
    p_provider, p_model_name, p_kind, p_input_per_1k_usd, p_output_per_1k_usd,
    COALESCE(p_effective_from, now()), true, p_notes,
    COALESCE(p_max_context_tokens, v_prior_ctx), COALESCE(p_max_output_tokens, v_prior_out)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

COMMENT ON FUNCTION public.apply_model_pricing_change(text, text, text, numeric, numeric, timestamptz, text, integer, integer) IS
  'THE versioned write for llm_model_pricing (B-1 follow-up). Locks the (provider, model_name, kind) active row, carries max_context_tokens/max_output_tokens from it unless supplied, deactivates that row and inserts the new active row in ONE transaction. The table CHECK is the only kind vocabulary. service_role only.';

REVOKE ALL ON FUNCTION public.apply_model_pricing_change(text, text, text, numeric, numeric, timestamptz, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_model_pricing_change(text, text, text, numeric, numeric, timestamptz, text, integer, integer)
  TO service_role;

-- Postconditions. Each RAISEs and names its trigger.
DO $$
DECLARE
  v_sig  regprocedure := 'public.apply_model_pricing_change(text, text, text, numeric, numeric, timestamptz, text, integer, integer)'::regprocedure;
  v_role text;
  v_def  boolean;
  v_cfg  text[];
BEGIN
  -- P1: no client role may execute it (trigger: the REVOKE line removed, or a later GRANT to a client role).
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondition P1 failed: % can EXECUTE apply_model_pricing_change', v_role;
    END IF;
  END LOOP;
  -- P2: service_role must execute it (trigger: the GRANT line removed on a FRESH create). NOTE: hosted
  -- Supabase's default function privileges may grant service_role EXECUTE regardless.
  IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition P2 failed: service_role cannot EXECUTE apply_model_pricing_change';
  END IF;
  -- P3: SECURITY INVOKER (trigger: SECURITY DEFINER). P4: search_path pinned EXACTLY (trigger: SET removed).
  SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg FROM pg_proc p WHERE p.oid = v_sig;
  IF v_def THEN
    RAISE EXCEPTION 'postcondition P3 failed: apply_model_pricing_change is SECURITY DEFINER';
  END IF;
  IF v_cfg IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp'] THEN
    RAISE EXCEPTION 'postcondition P4 failed: apply_model_pricing_change proconfig is %, expected {"search_path=pg_catalog, public, pg_temp"}', v_cfg;
  END IF;
END
$$;

COMMIT;
