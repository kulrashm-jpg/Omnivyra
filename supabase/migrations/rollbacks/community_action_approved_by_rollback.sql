-- ROLLBACK for 20270120000010_community_action_approved_by.sql
--
-- NOT applied anywhere. Production application is NOT authorized.
--
-- Restores the 20261231000005 body of claim_community_ai_browser_command,
-- whose approval clause WAIVES human approval (a bare approved_at, or an AI
-- requires_human_approval=false + non-high risk + policy). Restoring it lets
-- browser commands be claimed with no human approval, so this rollback
-- REFUSES (raises, changing nothing) unless the operator acknowledges it in
-- the same transaction:
--   SET LOCAL omnivyra.community_action_approved_by_restore_waiver = 'i-accept-unapproved-claims';
--
-- community_ai_actions.approved_by is KEPT by default: the approve route
-- writes it, and dropping it makes every approval fail again. It is dropped
-- (with its FK) only when, additionally,
--   SET LOCAL omnivyra.community_action_approved_by_drop_column = 'i-accept-approve-route-failure';
-- and even then the drop REFUSES while any row carries an approver: that is
-- the only record of who approved it on the row.
--
-- Run AFTER deploying application code that no longer depends on the human-
-- approval claim rule. Run inside a transaction; every refusal aborts it.

DO $$
DECLARE
  v_n bigint;
BEGIN
  IF coalesce(current_setting('omnivyra.community_action_approved_by_restore_waiver', true), '')
       <> 'i-accept-unapproved-claims' THEN
    RAISE EXCEPTION 'community action approved_by rollback: restoring the prior claim re-enables claims without human approval; set omnivyra.community_action_approved_by_restore_waiver to acknowledge';
  END IF;
  IF coalesce(current_setting('omnivyra.community_action_approved_by_drop_column', true), '')
       = 'i-accept-approve-route-failure' THEN
    SELECT count(*) INTO v_n FROM public.community_ai_actions WHERE approved_by IS NOT NULL;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'community action approved_by rollback: % actions record an approver; dropping approved_by would destroy that record', v_n;
    END IF;
  END IF;
END
$$;

-- The 20261231000005_extension_dispatch_safety.sql body, verbatim.
CREATE OR REPLACE FUNCTION public.claim_community_ai_browser_command(
  p_action_id         uuid,
  p_organization_id   uuid,
  p_lease_id          text,
  p_holder_id         text,
  p_lease_ttl_seconds integer
)
RETURNS TABLE (id uuid, dispatch_lease_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_execution_enabled      boolean;
  v_require_human_approval boolean;
BEGIN
  IF p_action_id IS NULL OR p_organization_id IS NULL
     OR coalesce(btrim(p_lease_id), '') = '' OR coalesce(btrim(p_holder_id), '') = '' THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: action, organization, lease and holder are required';
  END IF;
  IF p_lease_ttl_seconds IS NULL OR p_lease_ttl_seconds < 1 OR p_lease_ttl_seconds > 600 THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: lease ttl must be between 1 and 600 seconds';
  END IF;

  -- Platform policy: the most recent row wins; no row means the application
  -- defaults (execution enabled, no global approval requirement), exactly as
  -- communityAiPlatformPolicyService resolves it.
  SELECT p.execution_enabled, p.require_human_approval
    INTO v_execution_enabled, v_require_human_approval
    FROM community_ai_platform_policy p
   ORDER BY p.updated_at DESC
   LIMIT 1;
  v_execution_enabled      := coalesce(v_execution_enabled, true);
  v_require_human_approval := coalesce(v_require_human_approval, false);

  IF NOT v_execution_enabled THEN
    RETURN;  -- kill switch: nothing is claimed
  END IF;

  RETURN QUERY
  UPDATE community_ai_actions a
     SET dispatch_lease_id         = p_lease_id,
         dispatch_lease_expires_at = NOW() + make_interval(secs => p_lease_ttl_seconds),
         dispatch_lease_holder_id  = p_holder_id,
         updated_at                = NOW()
   WHERE a.id                  = p_action_id
     AND a.organization_id     = p_organization_id
     AND a.status              = 'pending'
     AND a.execution_mode      = 'browser'
     AND a.dispatch_lease_id   IS NULL
     AND a.cancel_requested_at IS NULL
     AND (
           a.approved_at IS NOT NULL
        OR (    a.requires_human_approval IS NOT TRUE
            AND coalesce(a.risk_level, '') <> 'high'
            AND NOT v_require_human_approval)
     )
  RETURNING a.id, a.dispatch_lease_expires_at;
END;
$$;

COMMENT ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) IS
  'extension_dispatch_safety: the only claim of a browser command. Atomic: tenant, pending, browser, never claimed, not cancelled, kill switch, approval.';

REVOKE EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) TO service_role;

-- Optional, explicitly acknowledged and refused above while any approver is recorded.
DO $$
BEGIN
  IF coalesce(current_setting('omnivyra.community_action_approved_by_drop_column', true), '')
       <> 'i-accept-approve-route-failure' THEN
    RAISE NOTICE 'community action approved_by rollback: keeping community_ai_actions.approved_by (the approve route writes it)';
    RETURN;
  END IF;
  ALTER TABLE public.community_ai_actions DROP CONSTRAINT IF EXISTS community_ai_actions_approved_by_fkey;
  ALTER TABLE public.community_ai_actions DROP COLUMN IF EXISTS approved_by;
END
$$;

-- ── Postconditions ───────────────────────────────────────────────────────────
DO $$
DECLARE
  f     regprocedure := to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)');
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = f;
  IF v_src IS NULL OR v_src NOT LIKE '%v_require_human_approval%' OR v_src LIKE '%community_ai_action_logs%' THEN
    RAISE EXCEPTION 'community action approved_by rollback postcondition: claim body is not the 20261231000005 version';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'community action approved_by rollback postcondition: claim function is not SECURITY DEFINER';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community action approved_by rollback postcondition: anon can execute the claim';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community action approved_by rollback postcondition: authenticated can execute the claim';
  END IF;
END
$$;
