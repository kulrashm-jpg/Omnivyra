-- Prompt 3 / C3: community action approval evidence and the single authoritative claim.
--
-- NOT applied anywhere. Production application is NOT authorized: it needs an
-- explicit owner decision after review. Written for, and tested only on, a
-- disposable test database.
--
-- Requires 20270120000010_community_action_approved_by.sql (approved_by and
-- the P-A browser claim) and 20270126000000_community_tenant_execution_policy.sql.
-- Refusal records are written through record_community_execution_refusal
-- (20270126000002); that function is resolved when a refusal happens, so both
-- migrations must be applied before either claim function is called.
--
-- 1. community_ai_actions evidence columns (nullable, NEVER backfilled):
--      approved_content_hash  sha-256 hex of the approved binding (computed by
--                             the approve route; execution_mode is not in it, LD-2)
--      passkey_credential_id  the WebAuthn credential verified for the approval
--      passkey_verified_at    when it was verified
--    CHECK community_ai_actions_approval_evidence: passkey id and time set
--    together; hash is 64 lower-case hex; none of them without approved_at.
--    Legacy rows carry none of them, so the CHECK validates immediately.
--
-- 2. community_action_approval_evidence_code(action, at) -> NULL or a code.
--    The ONE approval predicate, shared by both claim functions and the
--    backstop trigger. First match:
--      APPROVAL_REQUIRED            approved_at is NULL
--      APPROVAL_EVIDENCE_REQUIRED   approved_at later than `at`; approved_by
--                                   NULL; no 'approved' log by approved_by at
--                                   approved_at for this action, organization
--                                   and tenant (the P-A match); no or malformed
--                                   content hash; no passkey evidence, or
--                                   passkey verified outside
--                                   [approved_at - 5 min, approved_at + 60 s]
--      APPROVAL_EXPIRED             approved_at <= at - 7 days
--
-- 3. Trigger community_ai_actions_server_approved_at (BEFORE INSERT OR UPDATE
--    OF the approval columns):
--      UPDATE that records an approval (approved_at, approved_by, the hash or
--        the passkey evidence set to a new non-NULL value): refused while the
--        row holds a valid, unexpired approval (decided evidence is immutable,
--        LD-8); otherwise approved_at is stamped with the server clock,
--        truncated to milliseconds (the approve route logs the RETURNED value,
--        so the P-A log match holds). Clearing values is always allowed.
--      INSERT carrying an approved_at: stamped the same way (an approval is
--        never dated by its writer).
--      An approved_at later than the server clock is always refused.
--    TEST-ONLY BACK-DATE SEAM (fixtures that need an old approval): the
--    writer's approved_at is kept, instead of stamped, only when ALL of
--      - the SESSION role is a real superuser (pg_roles.rolsuper for
--        session_user; the disposable test cluster's harness connection),
--      - the CURRENT role is a real superuser too (so SET ROLE to a client
--        role, or any SECURITY DEFINER context owned by a non-superuser,
--        closes it), and
--      - SET LOCAL omnivyra.community_action_test_backdate = 'i-am-a-test-fixture'.
--    It can only fail closed: a kept value must not be later than the server
--    clock, so it can only make an approval older (closer to or past expiry);
--    the immutability rule still applies; every other check is unchanged.
--    service_role, authenticator and every other non-superuser session can
--    set the GUC but cannot use the seam. On hosted Supabase no client-facing
--    session role is a superuser.
--
-- 4. Trigger community_ai_actions_content_lock: while an approval is set
--    (approved_at NOT NULL before and after), platform, action_type,
--    target_id, discovered_user_id (the recipient), suggested_text,
--    playbook_id, organization_id, tenant_id and command_chain (every step's
--    payload) are immutable, and final_text may only be NULL or exactly
--    suggested_text (the approved text, '' when there is none; the execute
--    route stamps that). The database cannot recompute the approval hash; it freezes
--    its inputs instead. execution_mode is not locked (LD-2).
--
-- 5. claim_community_ai_action_for_execution(action, org, tenant, claim_point,
--    execution_mode, correlation_id) -> (claimed, code, current_status). The
--    single approved -> executing claim for every executor path (manual,
--    scheduler, auto, orchestration, rpa_retry). The row is locked FOR UPDATE;
--    then, in order: tenant scope; claimability (status 'approved' and no
--    cancel request; otherwise CLAIM_CONFLICT with its current status, and
--    NOTHING is written); policy decision (FOR SHARE), for claim_point 'auto'
--    the auto-rules switch, approval evidence, 7-day expiry; and the CAS
--    approved -> executing with tenant, organization and no cancel request.
--    A refusal writes ONE refusal record (record_community_execution_refusal)
--    and leaves the row untouched (still 'approved', LD-7). Not found: ACTION_NOT_FOUND; another tenant's row:
--    TENANT_SCOPE_VIOLATION; neither writes anything.
--
-- 6. claim_community_ai_browser_command: CREATE OR REPLACE with the same
--    signature and return. Every P-A condition is kept (the evidence predicate
--    contains the P-A match); added: the policy decision for the row's tenant,
--    passkey + hash evidence, and the 7-day check, applied on every claim of
--    every chain step (LD-1). A refused, otherwise claimable row writes one
--    refusal record (claim_point 'browser').
--
-- 7. Backstop trigger community_ai_actions_claim_requires_approval (BEFORE
--    UPDATE OF status, dispatch_lease_id): a row moving INTO 'executing', or a
--    dispatch lease going from NULL to set, must pass the same policy decision
--    and evidence predicate, or the UPDATE is refused. A writer that skips the
--    claim functions therefore cannot claim. Writes that move a row out of
--    'executing', back to 'pending', or clear a lease are not affected.
--    The same function also guards INSERT (trigger
--    community_ai_actions_x_insert_claim_requires_approval, BEFORE INSERT): a
--    row inserted already 'executing' or with a dispatch lease must pass the
--    same predicate. No application writer inserts either (verified: the
--    auto-rule, Omnivyra, engagement evaluation/ingest, idempotency fence,
--    network-expansion and platform-sync inserts are all 'pending' or
--    'skipped' and unleased). The 'x_' prefix orders it AFTER
--    community_ai_actions_server_approved_at (triggers fire in name order),
--    so it judges the server-stamped approved_at.
--
-- Grants: every function is service_role only (REVOKE from PUBLIC, anon,
-- authenticated); trigger functions have no grants.
-- ROLLBACK: supabase/migrations/rollbacks/community_action_approval_claim_rollback.sql

DO $$
BEGIN
  IF to_regprocedure('public.community_execution_policy_decision(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'community action approval claim: apply 20270126000000_community_tenant_execution_policy.sql first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'community_ai_actions' AND column_name = 'approved_by') THEN
    RAISE EXCEPTION 'community action approval claim: apply 20270120000010_community_action_approved_by.sql first';
  END IF;
  IF to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'community action approval claim: claim_community_ai_browser_command is absent';
  END IF;
END
$$;

ALTER TABLE public.community_ai_actions
  ADD COLUMN IF NOT EXISTS approved_content_hash text,
  ADD COLUMN IF NOT EXISTS passkey_credential_id text,
  ADD COLUMN IF NOT EXISTS passkey_verified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.community_ai_actions'::regclass
                    AND conname = 'community_ai_actions_approval_evidence') THEN
    ALTER TABLE public.community_ai_actions
      ADD CONSTRAINT community_ai_actions_approval_evidence
      CHECK ((passkey_credential_id IS NULL) = (passkey_verified_at IS NULL)
             AND (passkey_credential_id IS NULL OR length(passkey_credential_id) > 0)
             AND (approved_content_hash IS NULL OR approved_content_hash ~ '^[0-9a-f]{64}$')
             AND ((approved_content_hash IS NULL AND passkey_credential_id IS NULL) OR approved_at IS NOT NULL));
  END IF;
END
$$;

-- ── 2. the approval predicate ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_action_approval_evidence_code(p_action public.community_ai_actions, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_action.approved_at IS NULL THEN
    RETURN 'APPROVAL_REQUIRED';
  END IF;
  IF p_at IS NULL
     OR p_action.approved_at > p_at
     OR p_action.approved_by IS NULL
     OR p_action.approved_content_hash IS NULL
     OR p_action.approved_content_hash !~ '^[0-9a-f]{64}$'
     OR p_action.passkey_credential_id IS NULL
     OR p_action.passkey_verified_at IS NULL
     OR p_action.passkey_verified_at < p_action.approved_at - interval '5 minutes'
     OR p_action.passkey_verified_at > p_action.approved_at + interval '60 seconds'
     OR NOT EXISTS (
          SELECT 1
            FROM community_ai_action_logs l
           WHERE l.action_id                   = p_action.id
             AND l.organization_id             = p_action.organization_id
             AND l.tenant_id                   = p_action.tenant_id
             AND l.event_type                  = 'approved'
             AND l.event_payload ->> 'user_id' = p_action.approved_by::text
             AND l.event_payload ->> 'timestamp'
                   = to_char(p_action.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
    RETURN 'APPROVAL_EVIDENCE_REQUIRED';
  END IF;
  IF p_action.approved_at <= p_at - interval '7 days' THEN
    RETURN 'APPROVAL_EXPIRED';
  END IF;
  RETURN NULL;
END
$$;

-- ── 3. server-stamped approval, decided evidence immutable ──────────────────
CREATE OR REPLACE FUNCTION public.community_ai_actions_server_approved_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      timestamptz := clock_timestamp();
  v_backdate boolean := coalesce(current_setting('omnivyra.community_action_test_backdate', true), '') = 'i-am-a-test-fixture'
                        AND coalesce((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = session_user), false)
                        AND coalesce((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user), false);
BEGIN
  IF NEW.approved_at IS NOT NULL AND NEW.approved_at > v_now THEN
    RAISE EXCEPTION 'community_ai_actions: approved_at % is later than the server clock', NEW.approved_at
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.approved_at IS NOT NULL AND NOT v_backdate THEN
      NEW.approved_at := date_trunc('milliseconds', v_now);
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at)
     OR (NEW.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by)
     OR (NEW.approved_content_hash IS NOT NULL AND NEW.approved_content_hash IS DISTINCT FROM OLD.approved_content_hash)
     OR (NEW.passkey_credential_id IS NOT NULL AND NEW.passkey_credential_id IS DISTINCT FROM OLD.passkey_credential_id)
     OR (NEW.passkey_verified_at IS NOT NULL AND NEW.passkey_verified_at IS DISTINCT FROM OLD.passkey_verified_at) THEN
    IF public.community_action_approval_evidence_code(OLD, v_now) IS NULL THEN
      RAISE EXCEPTION 'community_ai_actions %: a valid, unexpired approval is recorded; decided evidence cannot be rewritten', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (v_backdate AND NEW.approved_at IS NOT NULL) THEN
      NEW.approved_at := date_trunc('milliseconds', v_now);
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS community_ai_actions_server_approved_at ON public.community_ai_actions;
CREATE TRIGGER community_ai_actions_server_approved_at
  BEFORE INSERT OR UPDATE OF approved_at, approved_by, approved_content_hash, passkey_credential_id, passkey_verified_at
  ON public.community_ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.community_ai_actions_server_approved_at();

-- ── 4. content lock while approved ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_ai_actions_content_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.platform        IS DISTINCT FROM OLD.platform
     OR NEW.action_type     IS DISTINCT FROM OLD.action_type
     OR NEW.target_id       IS DISTINCT FROM OLD.target_id
     OR NEW.discovered_user_id IS DISTINCT FROM OLD.discovered_user_id
     OR NEW.suggested_text  IS DISTINCT FROM OLD.suggested_text
     OR NEW.playbook_id     IS DISTINCT FROM OLD.playbook_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.command_chain   IS DISTINCT FROM OLD.command_chain THEN
    RAISE EXCEPTION 'community_ai_actions %: approved content, target, recipient, tenant and command chain are immutable while an approval is set; clear the approval first', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.final_text IS NOT NULL AND NEW.final_text IS DISTINCT FROM coalesce(NEW.suggested_text, '') THEN
    RAISE EXCEPTION 'community_ai_actions %: final_text must be the approved text while an approval is set', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS community_ai_actions_content_lock ON public.community_ai_actions;
CREATE TRIGGER community_ai_actions_content_lock
  BEFORE UPDATE OF platform, action_type, target_id, discovered_user_id, suggested_text, playbook_id, organization_id, tenant_id,
                   final_text, command_chain
  ON public.community_ai_actions
  FOR EACH ROW
  WHEN (OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT NULL)
  EXECUTE FUNCTION public.community_ai_actions_content_lock();

-- ── 5. the single approved -> executing claim ───────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_community_ai_action_for_execution(
  p_action_id      uuid,
  p_org            uuid,
  p_tenant         uuid,
  p_claim_point    text,
  p_execution_mode text,
  p_correlation_id text
)
RETURNS TABLE (claimed boolean, code text, current_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_policy record;
  v_row    community_ai_actions%ROWTYPE;
  v_code   text;
  v_now    timestamptz;
  v_mode   text := nullif(btrim(coalesce(p_execution_mode, '')), '');
  v_corr   uuid;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'claim_community_ai_action_for_execution: action is required';
  END IF;
  IF p_claim_point IS NULL OR p_claim_point NOT IN ('manual', 'scheduler', 'auto', 'orchestration', 'rpa_retry') THEN
    RAISE EXCEPTION 'claim_community_ai_action_for_execution: invalid claim point %', p_claim_point;
  END IF;
  IF p_correlation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_corr := p_correlation_id::uuid;
  END IF;

  SELECT * INTO v_policy FROM community_execution_policy_decision(p_org, p_tenant);
  IF v_policy.code = 'POLICY_SCOPE_INVALID' THEN
    RETURN QUERY SELECT false, v_policy.code, NULL::text; RETURN;
  END IF;

  SELECT * INTO v_row FROM community_ai_actions a WHERE a.id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ACTION_NOT_FOUND'::text, NULL::text; RETURN;
  END IF;
  IF v_row.organization_id IS DISTINCT FROM p_org OR v_row.tenant_id IS DISTINCT FROM p_tenant THEN
    RETURN QUERY SELECT false, 'TENANT_SCOPE_VIOLATION'::text, NULL::text; RETURN;
  END IF;

  IF v_row.status IS DISTINCT FROM 'approved' OR v_row.cancel_requested_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'CLAIM_CONFLICT'::text, v_row.status; RETURN;
  END IF;

  v_now := clock_timestamp();
  IF NOT v_policy.allowed THEN
    v_code := v_policy.code;
  ELSIF p_claim_point = 'auto' AND v_policy.auto_rules_enabled IS NOT TRUE THEN
    v_code := 'POLICY_AUTO_RULES_DISABLED';
  ELSE
    v_code := community_action_approval_evidence_code(v_row, v_now);
  END IF;
  IF v_code IS NOT NULL THEN
    PERFORM record_community_execution_refusal(v_row.id, v_row.organization_id, v_row.tenant_id, p_claim_point, v_code, NULL::uuid,
      jsonb_build_object('source', 'claim', 'execution_mode', v_mode, 'status', v_row.status));
    RETURN QUERY SELECT false, v_code, v_row.status; RETURN;
  END IF;

  UPDATE community_ai_actions a
     SET status                   = 'executing',
         updated_at               = (v_now AT TIME ZONE 'UTC'),
         execution_mode           = coalesce(v_mode, a.execution_mode),
         execution_correlation_id = coalesce(v_corr, a.execution_correlation_id)
   WHERE a.id = v_row.id
     AND a.organization_id = p_org
     AND a.tenant_id = p_tenant
     AND a.status = 'approved'
     AND a.cancel_requested_at IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'CLAIM_CONFLICT'::text, v_row.status; RETURN;
  END IF;
  RETURN QUERY SELECT true, NULL::text, 'executing'::text;
END
$$;

COMMENT ON FUNCTION public.claim_community_ai_action_for_execution(uuid, uuid, uuid, text, text, text) IS
  'community_action_approval_claim: the single approved -> executing claim (policy, evidence, 7 days, CAS). One refusal record per refusal; nothing for a conflict.';

-- ── 6. the browser claim: P-A + policy + evidence + 7 days ──────────────────
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
  v_row    community_ai_actions%ROWTYPE;
  v_policy record;
  v_code   text;
BEGIN
  IF p_action_id IS NULL OR p_organization_id IS NULL
     OR coalesce(btrim(p_lease_id), '') = '' OR coalesce(btrim(p_holder_id), '') = '' THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: action, organization, lease and holder are required';
  END IF;
  IF p_lease_ttl_seconds IS NULL OR p_lease_ttl_seconds < 1 OR p_lease_ttl_seconds > 600 THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: lease ttl must be between 1 and 600 seconds';
  END IF;

  SELECT * INTO v_row FROM community_ai_actions a
   WHERE a.id = p_action_id AND a.organization_id = p_organization_id
     FOR UPDATE;
  IF NOT FOUND
     OR v_row.status IS DISTINCT FROM 'pending'
     OR v_row.execution_mode IS DISTINCT FROM 'browser'
     OR v_row.dispatch_lease_id IS NOT NULL
     OR v_row.cancel_requested_at IS NOT NULL THEN
    RETURN;  -- not claimable (or already claimed): nothing is written
  END IF;

  SELECT * INTO v_policy FROM community_execution_policy_decision(v_row.organization_id, v_row.tenant_id);
  IF NOT v_policy.allowed THEN
    v_code := v_policy.code;
  ELSE
    v_code := community_action_approval_evidence_code(v_row, clock_timestamp());
  END IF;
  IF v_code IS NOT NULL THEN
    PERFORM record_community_execution_refusal(v_row.id, v_row.organization_id, v_row.tenant_id, 'browser', v_code, NULL::uuid,
      jsonb_build_object('source', 'browser_claim'));
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE community_ai_actions a
     SET dispatch_lease_id         = p_lease_id,
         dispatch_lease_expires_at = NOW() + make_interval(secs => p_lease_ttl_seconds),
         dispatch_lease_holder_id  = p_holder_id,
         updated_at                = NOW()
   WHERE a.id                  = v_row.id
     AND a.organization_id     = p_organization_id
     AND a.status              = 'pending'
     AND a.execution_mode      = 'browser'
     AND a.dispatch_lease_id   IS NULL
     AND a.cancel_requested_at IS NULL
  RETURNING a.id, a.dispatch_lease_expires_at;
END;
$$;

COMMENT ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) IS
  'community_action_approval_claim: the only claim of a browser command. Atomic: tenant, pending, browser, never claimed, not cancelled, tenant execution policy, and a current human approval (approved_at + approved_by + the approve route''s matching approved event + content hash + passkey, under 7 days). No AI, risk or policy waiver.';

-- ── 7. backstop: no claim without the same predicate ────────────────────────
CREATE OR REPLACE FUNCTION public.community_ai_actions_claim_requires_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy record;
  v_code   text;
BEGIN
  SELECT * INTO v_policy FROM public.community_execution_policy_decision(NEW.organization_id, NEW.tenant_id);
  IF NOT v_policy.allowed THEN
    v_code := v_policy.code;
  ELSE
    v_code := public.community_action_approval_evidence_code(NEW, clock_timestamp());
  END IF;
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION 'community action % cannot be claimed for execution: %', NEW.id, v_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS community_ai_actions_x_insert_claim_requires_approval ON public.community_ai_actions;
CREATE TRIGGER community_ai_actions_x_insert_claim_requires_approval
  BEFORE INSERT ON public.community_ai_actions
  FOR EACH ROW
  WHEN (NEW.status = 'executing' OR NEW.dispatch_lease_id IS NOT NULL)
  EXECUTE FUNCTION public.community_ai_actions_claim_requires_approval();

DROP TRIGGER IF EXISTS community_ai_actions_claim_requires_approval ON public.community_ai_actions;
CREATE TRIGGER community_ai_actions_claim_requires_approval
  BEFORE UPDATE OF status, dispatch_lease_id ON public.community_ai_actions
  FOR EACH ROW
  WHEN ((NEW.status = 'executing' AND OLD.status IS DISTINCT FROM 'executing')
        OR (OLD.dispatch_lease_id IS NULL AND NEW.dispatch_lease_id IS NOT NULL))
  EXECUTE FUNCTION public.community_ai_actions_claim_requires_approval();

-- ── Privileges ──────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.community_action_approval_evidence_code(public.community_ai_actions, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_community_ai_action_for_execution(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_ai_actions_server_approved_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_ai_actions_content_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_ai_actions_claim_requires_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_action_approval_evidence_code(public.community_ai_actions, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_community_ai_action_for_execution(uuid, uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) TO service_role;

-- ── Postconditions ──────────────────────────────────────────────────────────
DO $$
DECLARE
  f     text;
  v_src text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.community_action_approval_evidence_code(public.community_ai_actions,timestamptz)',
    'public.claim_community_ai_action_for_execution(uuid,uuid,uuid,text,text,text)',
    'public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)'] LOOP
    IF to_regprocedure(f) IS NULL OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN
      RAISE EXCEPTION 'community action approval claim postcondition: % absent or not SECURITY DEFINER', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'community action approval claim postcondition: anon can execute %', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'community action approval claim postcondition: authenticated can execute %', f;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)');
  IF v_src NOT LIKE '%community_action_approval_evidence_code%' OR v_src NOT LIKE '%community_execution_policy_decision%'
     OR v_src LIKE '%requires_human_approval%' OR v_src LIKE '%risk_level%' THEN
    RAISE EXCEPTION 'community action approval claim postcondition: browser claim body is not the evidence + policy version';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.community_ai_actions'::regclass AND NOT tgisinternal
         AND tgname IN ('community_ai_actions_server_approved_at', 'community_ai_actions_content_lock',
                        'community_ai_actions_claim_requires_approval',
                        'community_ai_actions_x_insert_claim_requires_approval')) <> 4 THEN
    RAISE EXCEPTION 'community action approval claim postcondition: a guard trigger is missing';
  END IF;
END
$$;
