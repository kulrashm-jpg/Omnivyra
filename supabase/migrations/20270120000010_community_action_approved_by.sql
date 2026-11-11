-- Community action human approver + browser-claim human-approval rule (P-A).
--
-- NOT applied anywhere. Production application is NOT authorized: it needs an
-- explicit owner decision after review. Provisional version number.
--
-- Two changes:
--
-- 1. community_ai_actions.approved_by uuid (nullable). The approve route
--    (pages/api/community-ai/actions/approve.ts) already writes
--    approved_by = the approving user; the column did not exist, so approval
--    failed on the replayed schema. NO backfill: approvers are never inferred
--    for existing rows. A row approved before this column (approved_at set,
--    approved_by NULL) is NOT claimable and needs a fresh approval.
--    Foreign key to public.users(id) ON DELETE SET NULL, the convention every
--    other approved_by column in this schema uses. Deleting the approver
--    nulls approved_by, which makes an unclaimed row unclaimable (fails
--    closed); no trigger on community_ai_actions refuses that SET NULL.
--
-- 2. claim_community_ai_browser_command(...) (CREATE OR REPLACE; replaces the
--    body from 20261231000005_extension_dispatch_safety.sql, which is NOT
--    edited). Signature, return shape, SECURITY DEFINER, search_path, grants
--    and the single conditional UPDATE ... RETURNING are unchanged. Every
--    existing condition is kept: tenant, status='pending' (the dispatch-queued
--    state: the executor writes an approved browser action back as 'pending'
--    for the extension), execution_mode='browser', never claimed, not
--    cancelled, platform kill switch. The approval clause is replaced.
--
--    REMOVED: the waiver "approved_at IS NOT NULL OR (requires_human_approval
--    IS NOT TRUE AND risk_level <> 'high' AND NOT policy.require_human_approval)".
--    requires_human_approval, risk_level and the platform policy's
--    require_human_approval are AI / policy metadata, not human authorization,
--    and a bare approved_at timestamp is not an approval.
--
--    REQUIRED, all of:
--      a.approved_at IS NOT NULL                    server-recorded approval time
--      a.approved_by IS NOT NULL                    the human approver (a users row, by FK)
--      a server-recorded approval event for this action, tenant and approver:
--        community_ai_action_logs row with action_id = a.id,
--        organization_id = a.organization_id, tenant_id = a.tenant_id,
--        event_type = 'approved', event_payload->>'user_id' = a.approved_by,
--        event_payload->>'timestamp' = a.approved_at (as approve.ts writes it:
--        the same ISO-8601 UTC millisecond string it stores in approved_at).
--      The event ties approved_by and approved_at to one approval written by
--      the approve route; columns set by any other writer do not claim.
--
-- Requires 20261231000005_extension_dispatch_safety.sql.
-- Idempotent (ADD COLUMN IF NOT EXISTS, guarded FK, CREATE OR REPLACE).
-- ROLLBACK: supabase/migrations/rollbacks/community_action_approved_by_rollback.sql

-- ── Preconditions ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.community_ai_actions') IS NULL THEN
    RAISE EXCEPTION 'community action approved_by: public.community_ai_actions is absent';
  END IF;
  IF to_regclass('public.community_ai_action_logs') IS NULL THEN
    RAISE EXCEPTION 'community action approved_by: public.community_ai_action_logs is absent';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'community action approved_by: public.users is absent';
  END IF;
  IF to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'community action approved_by: claim_community_ai_browser_command is absent (apply 20261231000005 first)';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
         AND column_name IN ('id', 'tenant_id', 'organization_id', 'status', 'execution_mode',
                             'dispatch_lease_id', 'dispatch_lease_expires_at', 'dispatch_lease_holder_id',
                             'cancel_requested_at', 'approved_at', 'updated_at')) <> 11 THEN
    RAISE EXCEPTION 'community action approved_by: community_ai_actions lacks a required column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
                    AND column_name = 'approved_at' AND data_type = 'timestamp with time zone') THEN
    RAISE EXCEPTION 'community action approved_by: community_ai_actions.approved_at is not timestamptz';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_action_logs'
         AND column_name IN ('action_id', 'tenant_id', 'organization_id', 'event_type', 'event_payload')) <> 5 THEN
    RAISE EXCEPTION 'community action approved_by: community_ai_action_logs lacks a required column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'users'
                    AND column_name = 'id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'community action approved_by: public.users.id is not uuid';
  END IF;
  -- Re-run safety: an existing approved_by must already be the expected type.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
                AND column_name = 'approved_by' AND data_type <> 'uuid') THEN
    RAISE EXCEPTION 'community action approved_by: community_ai_actions.approved_by exists and is not uuid';
  END IF;
END
$$;

-- ── 1. Approver column (no backfill) ────────────────────────────────────────
ALTER TABLE public.community_ai_actions ADD COLUMN IF NOT EXISTS approved_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.community_ai_actions'::regclass
                    AND conname  = 'community_ai_actions_approved_by_fkey') THEN
    ALTER TABLE public.community_ai_actions
      ADD CONSTRAINT community_ai_actions_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.community_ai_actions.approved_by IS
  'community_action_approved_by: the human user who approved this action (approve route). NULL = no recorded human approver; such a row is never claimed by the browser extension. Never backfilled.';

-- ── 2. Browser-command claim: human approval required ──────────────────────
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

COMMENT ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) IS
  'community_action_approved_by: the only claim of a browser command. Atomic: tenant, pending, browser, never claimed, not cancelled, kill switch, and a human approval (approved_at + approved_by + the approve route''s matching approved event). No AI, risk or policy waiver.';

-- ── Privileges: service role only (unchanged from 20261231000005) ───────────
REVOKE EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) TO service_role;

-- ── Postconditions ───────────────────────────────────────────────────────────
DO $$
DECLARE
  f   regprocedure := to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)');
  v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
                    AND column_name = 'approved_by' AND data_type = 'uuid' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'community action approved_by postcondition: approved_by is not a nullable uuid column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.community_ai_actions'::regclass
                    AND c.conname  = 'community_ai_actions_approved_by_fkey'
                    AND c.contype  = 'f'
                    AND c.confrelid = 'public.users'::regclass
                    AND c.confdeltype = 'n') THEN
    RAISE EXCEPTION 'community action approved_by postcondition: approved_by FK to users ON DELETE SET NULL is missing';
  END IF;
  IF f IS NULL THEN
    RAISE EXCEPTION 'community action approved_by postcondition: claim function is absent';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = f;
  IF v_src LIKE '%requires_human_approval%'
     OR v_src LIKE '%risk_level%'
     OR v_src NOT LIKE '%a.approved_by%'
     OR v_src NOT LIKE '%community_ai_action_logs%' THEN
    RAISE EXCEPTION 'community action approved_by postcondition: claim body is not the human-approval version';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'community action approved_by postcondition: claim function is not SECURITY DEFINER';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community action approved_by postcondition: anon can execute the claim';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community action approved_by postcondition: authenticated can execute the claim';
  END IF;
END
$$;
