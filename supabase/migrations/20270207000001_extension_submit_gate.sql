-- ============================================================================
-- Extension 1.5.0: command vocabulary + the submit gate
-- (docs/outreach/platform/EXTENSION-1.5.0-CONTRACT.md §4, §5.4)
-- Version 20270207000001, reserved by Release-controls (virality-83); depends on
-- 20270207000000. Reviewed: Orchestration (design + B1/S1-S5), PI/MIG-2R (F1-F6).
-- LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- 1. extension_commands: widen the legacy CHECKs for the 1.5 contract (old values
--    kept, so a strict superset). Added NOT VALID (enforced on new rows at once, no
--    full-table scan under ACCESS EXCLUSIVE) and then VALIDATEd under SHARE UPDATE
--    EXCLUSIVE. The DROP and ADD are inside this file's transaction, so a failure
--    can never leave the table without its CHECK.
-- 2. authorize_extension_submit: the last gate before an extension 1.5 write click.
--    Contract: on success, ONE update (submit_attempted_at, acting_member_urn,
--    updated_at) under the row lock; on an approval-evidence or policy refusal, ONE
--    refusal record via record_community_execution_refusal (audit parity with the
--    claim). Status, the lease, the approval and the policy are never changed.
--    The function runs in the caller's transaction: called through PostgREST it is
--    its own transaction and commits when it returns, so a refusal record survives.
--    A caller that wraps it in a longer transaction and rolls back loses the refusal
--    record too. A client retry records one refusal per attempt: duplicates are expected.
--
-- Postconditions (each RAISEs and names its trigger):
--   Q1 either CHECK lacks a 1.5 value, or is not validated
--   Q2 anon or authenticated may EXECUTE the function, or service_role may not
--   Q3 the function is SECURITY DEFINER
--   Q4 the function's search_path pin is missing (a later CREATE OR REPLACE without
--      SET would silently drop it and disarm the gate)
-- Rollback: rollbacks/extension_submit_gate_rollback.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.extension_account_bindings') IS NULL THEN
    RAISE EXCEPTION 'extension submit gate: apply 20270207000000 first (extension_account_bindings missing)';
  END IF;
  IF to_regprocedure('public.community_action_approval_evidence_code(public.community_ai_actions,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.community_execution_policy_decision(uuid,uuid)') IS NULL
     OR to_regprocedure('public.record_community_execution_refusal(uuid,uuid,uuid,text,text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'extension submit gate: a Prompt 3 / D-01 function is missing (20270126000000..02)';
  END IF;
END
$$;

-- 1. vocabulary
ALTER TABLE public.extension_commands DROP CONSTRAINT IF EXISTS extension_commands_action_type_check;
ALTER TABLE public.extension_commands ADD CONSTRAINT extension_commands_action_type_check CHECK (action_type = ANY (ARRAY[
  'post_reply', 'like', 'follow', 'share', 'dm_reply', 'save',
  'li.collect.own_post_comments', 'li.collect.own_inbox', 'li.salesnav.capture_saved_leads'])) NOT VALID;
ALTER TABLE public.extension_commands VALIDATE CONSTRAINT extension_commands_action_type_check;
ALTER TABLE public.extension_commands DROP CONSTRAINT IF EXISTS extension_commands_status_check;
ALTER TABLE public.extension_commands ADD CONSTRAINT extension_commands_status_check CHECK (status = ANY (ARRAY[
  'pending', 'executing', 'success', 'failed', 'cancelled',
  'dispatched', 'completed', 'refused', 'uncertain'])) NOT VALID;
ALTER TABLE public.extension_commands VALIDATE CONSTRAINT extension_commands_status_check;

-- 2. the submit gate
CREATE OR REPLACE FUNCTION public.authorize_extension_submit(
  p_action_id          uuid,
  p_organization_id    uuid,
  p_lease_id           text,
  p_holder_id          text,
  p_user_id            uuid,
  p_text_sha256        text,
  p_acting_member_urn  text
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      timestamptz := clock_timestamp();
  v_row      public.community_ai_actions;
  v_policy   record;
  v_policies integer := 0;
  v_code     text;
  v_text     text;
BEGIN
  SELECT * INTO v_row FROM public.community_ai_actions
   WHERE id = p_action_id AND organization_id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ACTION_NOT_FOUND'; END IF;
  IF v_row.platform <> 'linkedin' OR v_row.action_type NOT IN ('reply', 'like') OR v_row.execution_mode <> 'browser' THEN
    RETURN 'ACTION_NOT_ELIGIBLE';
  END IF;
  IF v_row.submit_attempted_at IS NOT NULL THEN RETURN 'ALREADY_SUBMITTED'; END IF;
  IF v_row.cancel_requested_at IS NOT NULL THEN RETURN 'CANCEL_REQUESTED'; END IF;
  IF v_row.dispatch_lease_id IS DISTINCT FROM p_lease_id OR v_row.dispatch_lease_holder_id IS DISTINCT FROM p_holder_id THEN
    RETURN 'LEASE_NOT_HELD';
  END IF;
  IF v_row.dispatch_lease_expires_at IS NULL OR v_row.dispatch_lease_expires_at <= v_now THEN
    RETURN 'LEASE_EXPIRED';
  END IF;
  -- B1 (Orchestration): terminal rows keep their lease fields (the reap guard turns
  -- failed into uncertain and KEEPS the lease; an in-window failed/executed/cancelled
  -- result does not clear it), so the lease alone does not prove in-flight.
  IF v_row.status IS NULL OR NOT (v_row.status = ANY (ARRAY['pending', 'dispatched', 'acknowledged'])) THEN
    RETURN 'ACTION_NOT_IN_FLIGHT';
  END IF;
  v_code := public.community_action_approval_evidence_code(v_row, v_now);   -- NULL means valid
  IF v_code IS NOT NULL THEN
    PERFORM public.record_community_execution_refusal(v_row.id, v_row.organization_id, v_row.tenant_id,
      'browser_submit', v_code, NULL, jsonb_build_object('source', 'authorize_submit'));
    RETURN v_code;
  END IF;
  -- F4 (PI): community_execution_policy_decision returns exactly one row on every
  -- path today; more than one would make SELECT INTO take an arbitrary row, so the
  -- count is guarded. Zero rows leaves v_policy with NULL fields -> POLICY_DENIED.
  FOR v_policy IN SELECT * FROM public.community_execution_policy_decision(v_row.organization_id, v_row.tenant_id) LOOP
    v_policies := v_policies + 1;
  END LOOP;
  IF v_policies <> 1 THEN
    v_code := CASE WHEN v_policies = 0 THEN 'POLICY_DENIED' ELSE 'POLICY_AMBIGUOUS' END;
  ELSIF NOT coalesce(v_policy.allowed, false) THEN
    v_code := coalesce(v_policy.code, 'POLICY_DENIED');
  END IF;
  IF v_code IS NOT NULL THEN
    PERFORM public.record_community_execution_refusal(v_row.id, v_row.organization_id, v_row.tenant_id,
      'browser_submit', v_code, NULL, jsonb_build_object('source', 'authorize_submit'));
    RETURN v_code;
  END IF;
  -- S4: the binding table has no session/holder column; bindings are per (org, user,
  -- platform). The route passes the session's user, from which the lease holder id is
  -- also derived, so another bound extension in the org cannot authorize this lease.
  -- This check is exactly as strong as the route's session derivation: SQL cannot
  -- recompute the nonce-based holder hash, so it trusts p_user_id from the service_role caller.
  IF NOT EXISTS (
       SELECT 1 FROM public.extension_account_bindings b
        WHERE b.org_id = v_row.organization_id AND b.user_id = p_user_id AND b.platform = 'linkedin'
          AND b.acting_member_urn = p_acting_member_urn AND b.revoked_at IS NULL) THEN
    RETURN 'BINDING_MISMATCH';
  END IF;
  -- Own content, fail closed: the target comment's thread was collected by 1.5 and
  -- its post authored by this member. (organization_id, platform, platform_message_id)
  -- is UNIQUE (idx_engagement_messages_org_platform_message_unique, ENG-004-CLOSE), so
  -- the match is the target message itself, not any message in an own thread.
  -- NOTE (S3): post_author_urn is reported by the same extension at ingestion, so this
  -- is a CONSISTENCY check against the binding, not independent proof of authorship;
  -- acceptable for v1 because every action still needs a human passkey approval.
  IF NOT EXISTS (
       SELECT 1 FROM public.engagement_messages m
         JOIN public.engagement_threads t ON t.id = m.thread_id AND t.organization_id = v_row.organization_id
        WHERE m.organization_id = v_row.organization_id
          AND m.platform = 'linkedin'
          AND m.platform_message_id = v_row.target_id
          AND t.platform = 'linkedin'
          AND t.raw_payload ->> 'ingested_via' = 'extension_v15'
          AND t.raw_payload ->> 'post_author_urn' = p_acting_member_urn) THEN
    RETURN 'NOT_OWN_CONTENT';
  END IF;
  IF v_row.action_type = 'reply' THEN
    -- S1: the approval binding hashes suggested_text; the content lock keeps
    -- final_text equal to it. Blank text is refused.
    v_text := v_row.suggested_text;
    IF v_text IS NULL OR btrim(v_text) = '' OR p_text_sha256 IS DISTINCT FROM encode(sha256(convert_to(v_text, 'UTF8')), 'hex') THEN
      RETURN 'TEXT_MISMATCH';
    END IF;
  END IF;
  UPDATE public.community_ai_actions
     SET submit_attempted_at = v_now, acting_member_urn = p_acting_member_urn, updated_at = v_now
   WHERE id = v_row.id AND submit_attempted_at IS NULL;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.authorize_extension_submit(uuid, uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_extension_submit(uuid, uuid, text, text, uuid, text, text) TO service_role;

DO $$
DECLARE
  fn  oid := to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)');
  bad text[] := ARRAY[]::text[];
  r   text;
BEGIN
  -- Q1
  -- Q1: every new value, on THIS table's constraints, validated (PI residuals R1, R2).
  FOREACH r IN ARRAY ARRAY['li.collect.own_post_comments', 'li.collect.own_inbox', 'li.salesnav.capture_saved_leads'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.extension_commands'::regclass
                    AND conname = 'extension_commands_action_type_check' AND convalidated
                    AND pg_get_constraintdef(oid) LIKE '%''' || r || '''%') THEN
      bad := bad || r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['dispatched', 'completed', 'refused', 'uncertain'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.extension_commands'::regclass
                    AND conname = 'extension_commands_status_check' AND convalidated
                    AND pg_get_constraintdef(oid) LIKE '%''' || r || '''%') THEN
      bad := bad || r;
    END IF;
  END LOOP;
  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'extension submit gate postcondition Q1: widened CHECK missing, unvalidated or lacking: %', array_to_string(bad, ', ');
  END IF;
  IF fn IS NULL THEN RAISE EXCEPTION 'extension submit gate postcondition Q2: function missing'; END IF;
  -- Q2
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, fn, 'EXECUTE') THEN
      bad := bad || r;
    END IF;
  END LOOP;
  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'extension submit gate postcondition Q2: client roles may execute: %', array_to_string(bad, ', ');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'extension submit gate postcondition Q2: service_role cannot execute';
  END IF;
  -- Q3
  IF (SELECT prosecdef FROM pg_proc WHERE oid = fn) THEN
    RAISE EXCEPTION 'extension submit gate postcondition Q3: function is SECURITY DEFINER';
  END IF;
  -- Q4
  IF (SELECT proconfig FROM pg_proc WHERE oid = fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'extension submit gate postcondition Q4: search_path pin is %', (SELECT proconfig FROM pg_proc WHERE oid = fn);
  END IF;
END
$$;

COMMIT;
