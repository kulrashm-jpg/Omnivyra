-- ROLLBACK for 20270126000001_community_action_approval_claim.sql
--
-- NOT applied anywhere. Production application is NOT authorized.
--
-- Drops the single claim claim_community_ai_action_for_execution, the
-- evidence predicate, the server-stamp, content-lock and backstop triggers
-- (UPDATE and INSERT) and
-- the evidence CHECK, and restores the 20270120000010 (P-A) body of
-- claim_community_ai_browser_command verbatim. That body has no tenant policy,
-- no passkey / content-hash evidence and no 7-day expiry, and with the
-- backstop gone a writer that skips the claim can claim again, so this
-- rollback REFUSES (raises, changing nothing) unless the operator
-- acknowledges it in the same transaction:
--   SET LOCAL omnivyra.community_action_approval_claim_restore = 'i-accept-claims-without-policy-and-expiry';
--
-- The evidence columns (approved_content_hash, passkey_credential_id,
-- passkey_verified_at) are KEPT by default: they are the only record of how an
-- approval was verified. They are dropped only when, additionally,
--   SET LOCAL omnivyra.community_action_approval_claim_drop_evidence = 'i-accept-evidence-loss';
-- and even then the drop REFUSES while any row carries evidence.
--
-- Run AFTER deploying application code that no longer calls
-- claim_community_ai_action_for_execution. Run inside a transaction; every
-- refusal aborts it.

DO $$
DECLARE
  v_n bigint;
BEGIN
  IF coalesce(current_setting('omnivyra.community_action_approval_claim_restore', true), '')
       <> 'i-accept-claims-without-policy-and-expiry' THEN
    RAISE EXCEPTION 'community action approval claim rollback: restoring the P-A claim removes the policy, evidence and expiry checks and the backstop; set omnivyra.community_action_approval_claim_restore to acknowledge';
  END IF;
  IF coalesce(current_setting('omnivyra.community_action_approval_claim_drop_evidence', true), '') = 'i-accept-evidence-loss' THEN
    SELECT count(*) INTO v_n FROM public.community_ai_actions
     WHERE approved_content_hash IS NOT NULL OR passkey_credential_id IS NOT NULL;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'community action approval claim rollback: % actions carry approval evidence; dropping the columns would destroy it', v_n;
    END IF;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS community_ai_actions_x_insert_claim_requires_approval ON public.community_ai_actions;
DROP TRIGGER IF EXISTS community_ai_actions_claim_requires_approval ON public.community_ai_actions;
DROP TRIGGER IF EXISTS community_ai_actions_content_lock ON public.community_ai_actions;
DROP TRIGGER IF EXISTS community_ai_actions_server_approved_at ON public.community_ai_actions;
DROP FUNCTION IF EXISTS public.community_ai_actions_claim_requires_approval();
DROP FUNCTION IF EXISTS public.community_ai_actions_content_lock();
DROP FUNCTION IF EXISTS public.community_ai_actions_server_approved_at();
DROP FUNCTION IF EXISTS public.claim_community_ai_action_for_execution(uuid, uuid, uuid, text, text, text);

-- The 20270120000010_community_action_approved_by.sql body, verbatim.
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
  v_execution_enabled boolean;
BEGIN
  IF p_action_id IS NULL OR p_organization_id IS NULL
     OR coalesce(btrim(p_lease_id), '') = '' OR coalesce(btrim(p_holder_id), '') = '' THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: action, organization, lease and holder are required';
  END IF;
  IF p_lease_ttl_seconds IS NULL OR p_lease_ttl_seconds < 1 OR p_lease_ttl_seconds > 600 THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: lease ttl must be between 1 and 600 seconds';
  END IF;

  -- Platform kill switch: the most recent policy row wins; no row means
  -- execution enabled, as communityAiPlatformPolicyService resolves it. The
  -- policy's require_human_approval is no longer read: human approval is
  -- required unconditionally below.
  SELECT p.execution_enabled
    INTO v_execution_enabled
    FROM community_ai_platform_policy p
   ORDER BY p.updated_at DESC
   LIMIT 1;
  v_execution_enabled := coalesce(v_execution_enabled, true);

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
     -- Human approval: approver, approval time, and the approve route's
     -- server-recorded event binding both to this action and tenant.
     AND a.approved_at         IS NOT NULL
     AND a.approved_by         IS NOT NULL
     AND EXISTS (
           SELECT 1
             FROM community_ai_action_logs l
            WHERE l.action_id                   = a.id
              AND l.organization_id             = a.organization_id
              AND l.tenant_id                   = a.tenant_id
              AND l.event_type                  = 'approved'
              AND l.event_payload ->> 'user_id' = a.approved_by::text
              AND l.event_payload ->> 'timestamp'
                    = to_char(a.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         )
  RETURNING a.id, a.dispatch_lease_expires_at;
END;
$$;

DROP FUNCTION IF EXISTS public.community_action_approval_evidence_code(public.community_ai_actions, timestamptz);
ALTER TABLE public.community_ai_actions DROP CONSTRAINT IF EXISTS community_ai_actions_approval_evidence;

COMMENT ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) IS
  'community_action_approved_by: the only claim of a browser command. Atomic: tenant, pending, browser, never claimed, not cancelled, kill switch, and a human approval (approved_at + approved_by + the approve route''s matching approved event). No AI, risk or policy waiver.';
REVOKE EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) TO service_role;

DO $$
BEGIN
  IF coalesce(current_setting('omnivyra.community_action_approval_claim_drop_evidence', true), '') = 'i-accept-evidence-loss' THEN
    ALTER TABLE public.community_ai_actions
      DROP COLUMN IF EXISTS approved_content_hash,
      DROP COLUMN IF EXISTS passkey_credential_id,
      DROP COLUMN IF EXISTS passkey_verified_at;
  END IF;
END
$$;
