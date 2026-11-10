-- ============================================================================
-- Extension 1.5.0: v15-only delivery mark on approved LinkedIn writes (U1)
-- (docs/outreach/platform/EXTENSION-1.5.0-CONTRACT.md §4, open item U1)
-- Version 20270207000002, reservation requested from Release-controls (virality-83);
-- depends on 20270207000000 and 20270207000001.
-- LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- U1: the 1.4 route (GET /api/extension/commands) skips LinkedIn reply/like only
-- for a session whose OWN user has a 1.5 binding. An unbound 1.4.x session of
-- ANOTHER user in the same organization could still claim an action that targets
-- a 1.5-collected own post and click it from a different LinkedIn account.
--
-- Fix: a mark on the action, computed by the database at creation for EVERY
-- writer (there are several insert paths, so the mark is not left to callers):
--   delivery_path = 'extension_v15' when a LinkedIn reply/like targets a message
--   in a thread collected by extension 1.5 (raw_payload.ingested_via =
--   'extension_v15'; the same target -> thread match as authorize_extension_submit).
-- The 1.4 route skips marked rows for every session; the v15 route offers only
-- marked rows. The two routes therefore offer disjoint sets.
--
-- The mark is authoritative and sticky:
--   * on INSERT the trigger computes it and overwrites any caller-supplied value;
--   * on UPDATE the trigger keeps the old value (a later re-ingestion of the
--     thread by 1.4, which rewrites raw_payload, cannot unmark a v15 action, and
--     no caller can set or clear it).
-- The trigger function is SECURITY DEFINER so the match does not depend on the
-- inserting role's RLS view of engagement_messages/threads (an invisible thread
-- would leave the row unmarked, i.e. 1.4-eligible: the unsafe direction). It reads
-- only, writes only NEW, and has its search_path pinned. The tenant boundary comes
-- from the argument: both sides of the join filter on p_organization_id.
-- WRITERS: every known insert path to community_ai_actions uses the service-role
-- client (ownedDbTable, or an injected service DbClient), under which INVOKER would
-- suffice. That is not proven for every path (nor for future ones), so DEFINER is
-- treated as load-bearing, not belt-and-braces.
--
-- authorize_extension_submit (from 20270207000001) is re-created here, unchanged
-- except for ONE added check after ACTION_NOT_ELIGIBLE: a row without the mark is
-- refused with NOT_V15_DELIVERY, so the click gate agrees with the offer split
-- (Orchestration review). It lives here, not in 000001, because it needs the column.
--
-- Backfill runs BEFORE the trigger exists (the sticky UPDATE rule would otherwise
-- keep NULL). Expected 0 rows wherever 1.5 has not ingested anything.
--
-- Postconditions (each RAISEs and names its trigger; the input that trips it):
--   V1 the column or its validated CHECK is missing
--      (e.g. a prior manual DROP COLUMN, or ADD COLUMN IF NOT EXISTS skipping a
--      pre-existing delivery_path with no such CHECK)
--   V2 the trigger is missing, not BEFORE ROW INSERT+UPDATE, disabled, or bound to
--      another function (e.g. a pre-existing trigger of that name, or ALTER TABLE
--      ... DISABLE TRIGGER in the same session)
--   V3 either function is not SECURITY DEFINER or its search_path pin is not exactly
--      {search_path=public, pg_temp} (e.g. a later CREATE OR REPLACE without SET)
--   V4 either function has proacl NULL (PUBLIC EXECUTE) or anon/authenticated may
--      EXECUTE it (e.g. the REVOKE removed, or a GRANT to authenticated)
--   V5 a row the predicate would mark is still NULL after the backfill (e.g. the
--      trigger created before the backfill, so the sticky UPDATE rule keeps NULL)
--   V6 authorize_extension_submit lacks NOT_V15_DELIVERY, is SECURITY DEFINER, lost
--      its search_path pin, or anon/authenticated may EXECUTE it (e.g. 000001's
--      body re-applied after this file)
-- Rollback: rollbacks/extension_v15_delivery_path_rollback.sql

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'extension v15 delivery path: apply 20270207000001 first (authorize_extension_submit missing)';
  END IF;
END
$$;

-- 1. the column (nullable, no default: catalog-only, no table rewrite)
ALTER TABLE public.community_ai_actions ADD COLUMN IF NOT EXISTS delivery_path text;
ALTER TABLE public.community_ai_actions DROP CONSTRAINT IF EXISTS community_ai_actions_delivery_path_check;
-- A plain ADD CONSTRAINT (MIG-2R): ADD COLUMN already holds ACCESS EXCLUSIVE until
-- COMMIT, so NOT VALID + VALIDATE in this file would buy nothing; every value is NULL here.
ALTER TABLE public.community_ai_actions ADD CONSTRAINT community_ai_actions_delivery_path_check
  CHECK (delivery_path IS NULL OR delivery_path = 'extension_v15');

-- 2. the shared predicate
CREATE OR REPLACE FUNCTION public.community_ai_action_v15_delivery_path(
  p_organization_id uuid,
  p_platform        text,
  p_action_type     text,
  p_target_id       text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN lower(btrim(coalesce(p_platform, ''))) = 'linkedin'
               AND lower(btrim(coalesce(p_action_type, ''))) IN ('reply', 'like')
               AND p_target_id IS NOT NULL
               AND EXISTS (
                     SELECT 1 FROM public.engagement_messages m
                       JOIN public.engagement_threads t ON t.id = m.thread_id AND t.organization_id = p_organization_id
                      WHERE m.organization_id = p_organization_id
                        AND m.platform = 'linkedin'
                        AND m.platform_message_id = p_target_id
                        AND t.platform = 'linkedin'
                        AND t.raw_payload ->> 'ingested_via' = 'extension_v15')
              THEN 'extension_v15' END
$$;

REVOKE ALL ON FUNCTION public.community_ai_action_v15_delivery_path(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- 3. backfill (before the trigger: see header)
UPDATE public.community_ai_actions a
   SET delivery_path = 'extension_v15'
 WHERE a.delivery_path IS NULL
   AND public.community_ai_action_v15_delivery_path(a.organization_id, a.platform, a.action_type, a.target_id) IS NOT NULL;

-- 4. the trigger
CREATE OR REPLACE FUNCTION public.community_ai_actions_set_delivery_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.delivery_path := public.community_ai_action_v15_delivery_path(NEW.organization_id, NEW.platform, NEW.action_type, NEW.target_id);
  ELSE
    NEW.delivery_path := OLD.delivery_path;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.community_ai_actions_set_delivery_path() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_ai_actions_delivery_path ON public.community_ai_actions;
CREATE TRIGGER community_ai_actions_delivery_path
  BEFORE INSERT OR UPDATE ON public.community_ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.community_ai_actions_set_delivery_path();

-- 5. the submit gate requires the mark
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
  -- U1 (20270207000002, Orchestration review): the click gate agrees with the offer
  -- split. Only a row the database marked v15-only at creation may be submitted by
  -- a 1.5 extension; an unmarked row belongs to the 1.4 route.
  IF v_row.delivery_path IS DISTINCT FROM 'extension_v15' THEN RETURN 'NOT_V15_DELIVERY'; END IF;
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

-- 6. postconditions
DO $$
DECLARE
  fns oid[] := ARRAY[
    to_regprocedure('public.community_ai_action_v15_delivery_path(uuid,text,text,text)'),
    to_regprocedure('public.community_ai_actions_set_delivery_path()')];
  fn  oid;
  r   text;
  bad text[] := ARRAY[]::text[];
BEGIN
  -- V1
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.community_ai_actions'::regclass
                  AND attname = 'delivery_path' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.community_ai_actions'::regclass
                     AND conname = 'community_ai_actions_delivery_path_check' AND convalidated) THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V1: column or validated CHECK missing';
  END IF;
  -- V2: BEFORE (bit 1) ROW (bit 0) INSERT (bit 2) UPDATE (bit 4), enabled
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.community_ai_actions'::regclass
                  AND tgname = 'community_ai_actions_delivery_path' AND NOT tgisinternal
                  AND tgenabled = 'O' AND (tgtype & 23) = 23
                  AND tgfoid = to_regprocedure('public.community_ai_actions_set_delivery_path()')) THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V2: trigger missing, wrong timing/events, or disabled';
  END IF;
  FOREACH fn IN ARRAY fns LOOP
    IF fn IS NULL THEN RAISE EXCEPTION 'extension v15 delivery path postcondition V3: function missing'; END IF;
    -- V3
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn)
       OR (SELECT proconfig FROM pg_proc WHERE oid = fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      RAISE EXCEPTION 'extension v15 delivery path postcondition V3: % not SECURITY DEFINER or search_path pin is %',
        fn::regprocedure, (SELECT proconfig FROM pg_proc WHERE oid = fn);
    END IF;
    -- V4 (proacl IS NULL means the PUBLIC default: open)
    IF (SELECT proacl FROM pg_proc WHERE oid = fn) IS NULL THEN
      RAISE EXCEPTION 'extension v15 delivery path postcondition V4: % has the default (PUBLIC) EXECUTE', fn::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, fn, 'EXECUTE') THEN
        bad := bad || (r || ':' || fn::regprocedure::text);
      END IF;
    END LOOP;
  END LOOP;
  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V4: client roles may execute: %', array_to_string(bad, ', ');
  END IF;
  -- V5
  IF EXISTS (SELECT 1 FROM public.community_ai_actions a
              WHERE a.delivery_path IS NULL
                AND public.community_ai_action_v15_delivery_path(a.organization_id, a.platform, a.action_type, a.target_id) IS NOT NULL) THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V5: a v15 LinkedIn write is unmarked';
  END IF;
  -- V6
  fn := to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)');
  IF fn IS NULL OR position('NOT_V15_DELIVERY' IN (SELECT prosrc FROM pg_proc WHERE oid = fn)) = 0 THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V6: submit gate missing or lacks NOT_V15_DELIVERY';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = fn)
     OR (SELECT proconfig FROM pg_proc WHERE oid = fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V6: submit gate is SECURITY DEFINER or lost its search_path pin';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'extension v15 delivery path postcondition V6: % may execute the submit gate', r;
    END IF;
  END LOOP;
END
$$;

COMMIT;
