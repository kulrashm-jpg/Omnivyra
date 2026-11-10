-- Rollback for 20270207000002_extension_v15_delivery_path.sql.
--
-- Drops the trigger, both functions, the CHECK and the column. After this the 1.4
-- route no longer skips v15 LinkedIn writes for other users (U1 returns), and the
-- v15 route offers nothing (its filter on delivery_path errors and fails closed).
-- Roll the application back first, or accept that window. Re-runnable.
-- authorize_extension_submit is restored to its 20270207000001 form FIRST (the
-- 000002 form reads delivery_path and would fail at run time without the column).

BEGIN;

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


DROP TRIGGER IF EXISTS community_ai_actions_delivery_path ON public.community_ai_actions;
DROP FUNCTION IF EXISTS public.community_ai_actions_set_delivery_path();
DROP FUNCTION IF EXISTS public.community_ai_action_v15_delivery_path(uuid, text, text, text);
ALTER TABLE public.community_ai_actions DROP CONSTRAINT IF EXISTS community_ai_actions_delivery_path_check;
ALTER TABLE public.community_ai_actions DROP COLUMN IF EXISTS delivery_path;

DO $$
DECLARE fn oid := to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.community_ai_actions'::regclass AND attname = 'delivery_path' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.community_ai_actions'::regclass AND conname = 'community_ai_actions_delivery_path_check')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.community_ai_actions'::regclass AND tgname = 'community_ai_actions_delivery_path')
     OR to_regprocedure('public.community_ai_actions_set_delivery_path()') IS NOT NULL
     OR to_regprocedure('public.community_ai_action_v15_delivery_path(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'extension v15 delivery path rollback postcondition: an object survived';
  END IF;
  IF fn IS NULL OR position('NOT_V15_DELIVERY' IN (SELECT prosrc FROM pg_proc WHERE oid = fn)) > 0
     OR (SELECT proconfig FROM pg_proc WHERE oid = fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'extension v15 delivery path rollback postcondition: submit gate not restored to its 20270207000001 form';
  END IF;
END
$$;

COMMIT;
