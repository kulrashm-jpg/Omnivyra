-- Community AI: the guardrail check and the claim become ONE atomic step (A19), and the engagement
-- send's plan usage is RESERVED atomically before the send (A20). Version 20270217000021, reserved
-- by virality-83 (registry 78e4bf0f7) for both, in one unit (e9 ruling 2026-11-12); on
-- fix/s-wa-combined.
--
-- A19. canExecuteAction (executionGuardrailService.ts) counted the actions against the daily /
-- per-post / per-evaluation limits, and the claim (claim_community_ai_action_for_execution) came
-- after, as a separate call. Two claimants (a scheduler and an auto-rule run, or two schedulers) both
-- counted N-1 and both claimed: real replies past the limit. a7a657cdc made the count include the
-- in-flight `executing` rows; the gap between the count and the claim needs the count and the claim
-- in ONE transaction under ONE lock:
--
--   community_ai_claim_within_limits - under a per (organization, platform) transaction advisory
--     lock: re-evaluate the action's guardrails exactly as canExecuteAction does, then, if within
--     every limit, run the EXISTING claim and return ITS answer unchanged. The claim moves the row to
--     `executing` inside this transaction, so a concurrent claimant waiting on the lock counts it.
--     A guardrail refusal claims nothing, leaves the row 'approved', records one governance refusal
--     (record_community_execution_refusal, as the claim records its own) and answers
--     (false, GUARDRAIL_*, status).
--
--   Parity with canExecuteAction, line by line:
--     - guardrails row: execution_guardrails.company_id = the action's ORGANIZATION (the callers pass
--       organization_id as company_id); no row = no limits (allow, then claim);
--     - auto_execution_enabled = false refuses (GUARDRAIL_AUTO_DISABLED);
--     - platform: lower(btrim(the action's platform)), compared EXACTLY to the stored platform;
--     - counted = (status 'executed' AND executed_at in the window) + (status 'executing', ANY age -
--       a stuck claim keeps counting until the reaper moves it; erring toward refusing);
--     - daily window: from 00:00 UTC today (EXPLICIT UTC; the service also uses UTC midnight);
--     - per-post: only when the action_type is 'reply' (lower/btrim), same target_id, action_type
--       'reply', no window;
--     - per-evaluation: only for p_source = 'evaluation', last 10 minutes.
--   Fail closed: any error raises (the caller's claim answers CLAIM_RPC_ERROR: not claimed).
--   Lock key (55): two ints, pg_advisory_xact_lock(hashtext('cai_guardrail'),
--   hashtext(org || ':' || platform)) - every limit is per (organization, platform).
--
-- A20. checkUsageBeforeExecution read the monthly meter and allowed while usage + 1 <= the plan's
-- allowed_until; the meter is incremented only AFTER a synchronous send (recordUsage). N concurrent
-- sends each read the same meter and all sent: an overshoot of up to N-1. Now the send RESERVES:
--
--   usage_execution_reserve - under a per (organization, month) advisory lock: used = the meter's
--     automation_executions + LIVE reservations; if used + 1 <= p_allowed_until, insert a
--     reservation and return it. Idempotent per action (one live reservation per action).
--   usage_execution_release - the send did not happen, or the meter now counts it.
--
--   A reservation is LIVE while not released and younger than p_ttl_seconds. A send that may have
--   acted but is not metered here (a browser dispatch, a deferred RPA run, an uncertain outcome) is
--   NOT released: its reservation counts until the TTL - erring toward refusing, never toward a
--   second grant.
--
-- GRANTS (owner rule; "class-wide revokes miss new tables"; "hosted Supabase gives service_role
-- ALL"): the table is REVOKEd from every client role and from service_role, then granted to
-- service_role exactly {SELECT, INSERT, UPDATE}; RLS enabled with one service_role-only policy. The
-- three functions are VOLATILE, SECURITY INVOKER, search_path pinned, EXECUTE revoked by full
-- signature and granted to service_role only. All asserted below.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.community_ai_actions') IS NULL OR to_regclass('public.execution_guardrails') IS NULL
     OR to_regclass('public.usage_meter_monthly') IS NULL THEN
    RAISE EXCEPTION 'AGCR preflight: community_ai_actions / execution_guardrails / usage_meter_monthly missing';
  END IF;
  IF to_regprocedure('public.claim_community_ai_action_for_execution(uuid, uuid, uuid, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'AGCR preflight: claim_community_ai_action_for_execution(uuid,uuid,uuid,text,text,text) is missing - it is the claim this migration wraps';
  END IF;
  IF to_regprocedure('public.record_community_execution_refusal(uuid, uuid, uuid, text, text, uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AGCR preflight: record_community_execution_refusal(uuid,uuid,uuid,text,text,uuid,jsonb) is missing';
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'AGCR preflight: auth.role() is missing - the house service_role policy cannot be expressed';
  END IF;
  -- CREATE OR REPLACE with a different argument list creates an OVERLOAD that callers never reach.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND (
                   (p.proname = 'community_ai_claim_within_limits' AND pg_get_function_identity_arguments(p.oid)
                      <> 'p_action_id uuid, p_org uuid, p_tenant uuid, p_claim_point text, p_execution_mode text, p_correlation_id text, p_source text')
                OR (p.proname = 'usage_execution_reserve' AND pg_get_function_identity_arguments(p.oid)
                      <> 'p_org uuid, p_year integer, p_month integer, p_action_id uuid, p_allowed_until numeric, p_ttl_seconds integer')
                OR (p.proname = 'usage_execution_release' AND pg_get_function_identity_arguments(p.oid)
                      <> 'p_reservation_id uuid, p_org uuid'))) THEN
    RAISE EXCEPTION 'AGCR preflight: another signature of community_ai_claim_within_limits / usage_execution_reserve / usage_execution_release exists - refusing to overload it';
  END IF;
  -- ROLLBACK SOUNDNESS (05 / e1 rule): the rollback drops the table and the three functions, so this
  -- apply must PROVE none of them predates it. Allowed: none present (first apply) or ALL present
  -- (a re-apply: the $verify$ below then re-asserts their exact shape). Anything in between refuses.
  IF (to_regclass('public.usage_execution_reservations') IS NOT NULL
      OR to_regprocedure('public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text)') IS NOT NULL
      OR to_regprocedure('public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer)') IS NOT NULL
      OR to_regprocedure('public.usage_execution_release(uuid, uuid)') IS NOT NULL)
     AND NOT (to_regclass('public.usage_execution_reservations') IS NOT NULL
      AND to_regprocedure('public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text)') IS NOT NULL
      AND to_regprocedure('public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer)') IS NOT NULL
      AND to_regprocedure('public.usage_execution_release(uuid, uuid)') IS NOT NULL
      -- to_regclass, never ::regclass: SQL does not promise the AND short-circuits, and the cast
      -- throws on a clean database where the table does not exist yet.
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.usage_execution_reservations')
                   AND conname = 'usage_execution_reservations_action_fk')
      -- NARROW (05): the exact column set of the table and the exact BODY (md5 of prosrc, LF or CRLF)
      -- of each function this migration installs - a same-named table or same-signature function
      -- that is someone else's is never taken for a re-apply. The postcondition asserts the hashes.
      -- names, TYPES and NOT NULL (05 gap 3): the table holds DATA - a same-named table of other types
      -- must never pass as a re-apply (its rollback drop would be irreversible, and the functions would
      -- run against incompatible columns). Ordered by name: physical order does not change the table.
      AND (SELECT array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
                            ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.usage_execution_reservations') AND a.attnum > 0 AND NOT a.attisdropped)
          = ARRAY['action_id uuid not null', 'id uuid not null', 'month integer not null', 'organization_id uuid not null',
                  'released_at timestamp with time zone', 'reserved_at timestamp with time zone not null', 'year integer not null']
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text)') AND md5(p.prosrc) = ANY (ARRAY['f34b1c37b8f424a06f6dc723dbfa5394', '4e08ee3d38f39996358cead6597c1af5']))
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer)') AND md5(p.prosrc) = ANY (ARRAY['6b248c44531b6d97d7137140e0d80ff2', 'f16e797f0f75345978d54ea1cf1e6c29']))
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.usage_execution_release(uuid, uuid)') AND md5(p.prosrc) = ANY (ARRAY['7757d352b546ccc7e6fac458b6b1577a', '621dcd59b9c30a76ad9e871efd8a34b8']))) THEN
    RAISE EXCEPTION 'AGCR preflight: usage_execution_reservations / the three functions partly exist - they predate this migration; refusing (its rollback must never drop them)';
  END IF;
END
$preflight$;


-- ── A19 ─────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.community_ai_claim_within_limits(
  p_action_id      uuid,
  p_org            uuid,
  p_tenant         uuid,
  p_claim_point    text,
  p_execution_mode text,
  p_correlation_id text,
  p_source         text
)
RETURNS TABLE (claimed boolean, code text, current_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_row       record;
  v_platform  text;
  v_g         record;
  v_day_start timestamptz := (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
  v_n         bigint;
  v_code      text;
BEGIN
  IF p_action_id IS NULL OR p_org IS NULL OR p_tenant IS NULL
     OR p_source IS NULL OR p_source NOT IN ('evaluation', 'scheduler') THEN
    RAISE EXCEPTION 'community_ai_claim_within_limits: invalid arguments' USING ERRCODE = '22023';
  END IF;

  SELECT a.organization_id, a.tenant_id, a.status, a.platform, a.action_type, a.target_id INTO v_row
    FROM public.community_ai_actions a WHERE a.id = p_action_id;
  IF NOT FOUND OR v_row.organization_id IS DISTINCT FROM p_org OR v_row.tenant_id IS DISTINCT FROM p_tenant
     OR v_row.status IS DISTINCT FROM 'approved' THEN
    -- Not ours to count: the claim answers it (ACTION_NOT_FOUND, TENANT_SCOPE_VIOLATION, CLAIM_CONFLICT).
    RETURN QUERY SELECT c.claimed, c.code, c.current_status
      FROM public.claim_community_ai_action_for_execution(p_action_id, p_org, p_tenant, p_claim_point, p_execution_mode, p_correlation_id) c;
    RETURN;
  END IF;

  v_platform := lower(btrim(coalesce(v_row.platform, '')));

  -- One (organization, platform) at a time: a concurrent claimant waits here, then counts our claim.
  PERFORM pg_advisory_xact_lock(hashtext('cai_guardrail'), hashtext(p_org::text || ':' || v_platform));

  SELECT g.auto_execution_enabled, g.daily_platform_limit, g.per_post_reply_limit, g.per_evaluation_limit INTO v_g
    FROM public.execution_guardrails g WHERE g.company_id = p_org;

  IF FOUND THEN
    IF v_g.auto_execution_enabled = false THEN
      v_code := 'GUARDRAIL_AUTO_DISABLED';
    END IF;

    IF v_code IS NULL AND v_g.daily_platform_limit IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.community_ai_actions a
       WHERE a.organization_id = p_org AND a.platform = v_platform
         AND ((a.status = 'executed' AND a.executed_at IS NOT NULL AND a.executed_at >= v_day_start)
              OR a.status = 'executing');
      IF v_n >= v_g.daily_platform_limit THEN v_code := 'GUARDRAIL_DAILY_PLATFORM_LIMIT'; END IF;
    END IF;

    IF v_code IS NULL AND lower(btrim(coalesce(v_row.action_type, ''))) = 'reply' AND v_g.per_post_reply_limit IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.community_ai_actions a
       WHERE a.organization_id = p_org AND a.platform = v_platform
         AND a.target_id = v_row.target_id AND a.action_type = 'reply'
         AND ((a.status = 'executed' AND a.executed_at IS NOT NULL) OR a.status = 'executing');
      IF v_n >= v_g.per_post_reply_limit THEN v_code := 'GUARDRAIL_PER_POST_LIMIT'; END IF;
    END IF;

    IF v_code IS NULL AND p_source = 'evaluation' AND v_g.per_evaluation_limit IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.community_ai_actions a
       WHERE a.organization_id = p_org AND a.platform = v_platform
         AND ((a.status = 'executed' AND a.executed_at IS NOT NULL AND a.executed_at >= now() - interval '10 minutes')
              OR a.status = 'executing');
      IF v_n >= v_g.per_evaluation_limit THEN v_code := 'GUARDRAIL_PER_EVALUATION_LIMIT'; END IF;
    END IF;

    IF v_code IS NOT NULL THEN
      PERFORM public.record_community_execution_refusal(p_action_id, p_org, p_tenant, p_claim_point, v_code, NULL::uuid,
        jsonb_build_object('source', 'guardrail_claim', 'guardrail_source', p_source, 'platform', v_platform));
      RETURN QUERY SELECT false, v_code, v_row.status::text;
      RETURN;
    END IF;
  END IF;

  -- Within every limit: the EXISTING claim, its answer returned unchanged.
  RETURN QUERY SELECT c.claimed, c.code, c.current_status
    FROM public.claim_community_ai_action_for_execution(p_action_id, p_org, p_tenant, p_claim_point, p_execution_mode, p_correlation_id) c;
END
$fn$;

COMMENT ON FUNCTION public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text) IS
  'A19: the execution guardrails (as canExecuteAction) and the claim in ONE transaction under a per '
  '(organization, platform) advisory lock. Within limits: the claim''s answer unchanged. Refused: '
  '(false, GUARDRAIL_*, status), nothing claimed, one refusal record.';


-- ── A20 ─────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usage_execution_reservations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  year            integer     NOT NULL,
  month           integer     NOT NULL CHECK (month BETWEEN 1 AND 12),
  action_id       uuid        NOT NULL
    CONSTRAINT usage_execution_reservations_action_fk
    REFERENCES public.community_ai_actions (id) ON DELETE CASCADE,
  reserved_at     timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_usage_execution_reservations_live
  ON public.usage_execution_reservations (organization_id, year, month, reserved_at) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS usage_execution_reservations_one_live_per_action
  ON public.usage_execution_reservations (action_id) WHERE released_at IS NULL;

COMMENT ON TABLE public.usage_execution_reservations IS
  'A20: plan-usage reservations for community engagement sends. Written ONLY by '
  'usage_execution_reserve / usage_execution_release. A reservation counts against the plan until '
  'it is released (the meter counts the send, or it did not happen) or its TTL passes.';

ALTER TABLE public.usage_execution_reservations ENABLE ROW LEVEL SECURITY;

DO $agcr_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'usage_execution_reservations'
       AND policyname = 'usage_execution_reservations_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY usage_execution_reservations_service_role ON public.usage_execution_reservations;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'usage_execution_reservations'
       AND policyname = 'usage_execution_reservations_service_role'
  ) THEN
    CREATE POLICY usage_execution_reservations_service_role
      ON public.usage_execution_reservations
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$agcr_rls$;

REVOKE ALL ON TABLE public.usage_execution_reservations
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.usage_execution_reservations TO service_role;


CREATE OR REPLACE FUNCTION public.usage_execution_reserve(
  p_org           uuid,
  p_year          integer,
  p_month         integer,
  p_action_id     uuid,
  p_allowed_until numeric,
  p_ttl_seconds   integer
)
RETURNS TABLE (granted boolean, reservation_id uuid, used numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_live_after timestamptz;
  v_used       numeric;
  v_id         uuid;
BEGIN
  IF p_org IS NULL OR p_action_id IS NULL OR p_year IS NULL OR p_month IS NULL OR p_month NOT BETWEEN 1 AND 12
     OR p_allowed_until IS NULL OR p_allowed_until < 0
     OR p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 172800 THEN
    RAISE EXCEPTION 'usage_execution_reserve: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- One (organization, month) at a time: a concurrent reserve waits here, then counts our row.
  PERFORM pg_advisory_xact_lock(hashtext('usage_exec_reserve'), hashtext(p_org::text || ':' || p_year || '-' || p_month));

  v_live_after := now() - make_interval(secs => p_ttl_seconds);

  -- An expired reservation of this action no longer counts; retire it so the action may reserve again.
  UPDATE public.usage_execution_reservations r
     SET released_at = now()
   WHERE r.action_id = p_action_id AND r.released_at IS NULL AND r.reserved_at < v_live_after;

  SELECT
    coalesce((SELECT m.automation_executions FROM public.usage_meter_monthly m
               WHERE m.organization_id = p_org AND m.year = p_year AND m.month = p_month), 0)
  + (SELECT count(*) FROM public.usage_execution_reservations r
      WHERE r.organization_id = p_org AND r.year = p_year AND r.month = p_month
        AND r.released_at IS NULL AND r.reserved_at >= v_live_after)
  INTO v_used;

  -- Idempotent per action: its live reservation is the grant (already counted in v_used).
  SELECT r.id INTO v_id FROM public.usage_execution_reservations r
   WHERE r.action_id = p_action_id AND r.released_at IS NULL;
  IF FOUND THEN
    RETURN QUERY SELECT true, v_id, v_used;
    RETURN;
  END IF;

  IF v_used + 1 > p_allowed_until THEN
    RETURN QUERY SELECT false, NULL::uuid, v_used;
    RETURN;
  END IF;

  INSERT INTO public.usage_execution_reservations (organization_id, year, month, action_id)
  VALUES (p_org, p_year, p_month, p_action_id)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, v_id, v_used + 1;
END
$fn$;

COMMENT ON FUNCTION public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer) IS
  'A20: atomically (per organization-month advisory lock) count the meter + live reservations and, '
  'within allowed_until, reserve one execution. granted=false writes nothing. Idempotent per action.';


CREATE OR REPLACE FUNCTION public.usage_execution_release(
  p_reservation_id uuid,
  p_org            uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF p_reservation_id IS NULL OR p_org IS NULL THEN
    RAISE EXCEPTION 'usage_execution_release: invalid arguments' USING ERRCODE = '22023';
  END IF;
  UPDATE public.usage_execution_reservations
     SET released_at = now()
   WHERE id = p_reservation_id AND organization_id = p_org AND released_at IS NULL;
  RETURN FOUND;
END
$fn$;

COMMENT ON FUNCTION public.usage_execution_release(uuid, uuid) IS
  'A20: release a reservation whose send did not happen, or that the meter now counts. true = released now.';


REVOKE ALL ON FUNCTION public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer) TO service_role;
REVOKE ALL ON FUNCTION public.usage_execution_release(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usage_execution_release(uuid, uuid) TO service_role;


DO $verify$
DECLARE
  v_rls       boolean;
  v_force     boolean;
  v_n         integer;
  v_pol_roles text[];
  v_priv      text[];
  v_leaked    text[];
  v_fn        regprocedure;
  v_secdef    boolean;
  v_config    text[];
  v_vol       "char";
  v_fns       text[] := ARRAY[
    'public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text)',
    'public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer)',
    'public.usage_execution_release(uuid, uuid)'];
  v_sig       text;
BEGIN
  IF to_regclass('public.usage_execution_reservations') IS NULL THEN
    RAISE EXCEPTION 'AGCR postcondition: usage_execution_reservations is missing';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.usage_execution_reservations'::regclass
     AND conname = 'usage_execution_reservations_action_fk' AND contype = 'f' AND confdeltype = 'c';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'AGCR postcondition: usage_execution_reservations_action_fk must reference community_ai_actions ON DELETE CASCADE';
  END IF;
  SELECT count(*) INTO v_n FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.usage_execution_reservations'::regclass
     AND c.relname = 'usage_execution_reservations_one_live_per_action' AND i.indisunique
     AND pg_get_expr(i.indpred, i.indrelid) = '(released_at IS NULL)';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'AGCR postcondition: one live reservation per action must be a UNIQUE partial index';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'public.usage_execution_reservations'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'AGCR postcondition: row level security must be ENABLED'; END IF;
  IF v_force THEN RAISE EXCEPTION 'AGCR postcondition: row level security must NOT be FORCED'; END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'usage_execution_reservations';
  IF v_n <> 1 THEN RAISE EXCEPTION 'AGCR postcondition: expected exactly 1 policy, found %', v_n; END IF;
  SELECT roles::text[] INTO v_pol_roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'usage_execution_reservations'
     AND policyname = 'usage_execution_reservations_service_role';
  IF v_pol_roles IS DISTINCT FROM ARRAY['service_role'] THEN
    RAISE EXCEPTION 'AGCR postcondition: the policy must apply to exactly {service_role}, found %', v_pol_roles;
  END IF;

  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.usage_execution_reservations'::regclass AND r2.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['INSERT', 'SELECT', 'UPDATE'] THEN
    RAISE EXCEPTION 'AGCR postcondition: service_role must hold exactly {INSERT,SELECT,UPDATE}, found %', coalesce(v_priv::text, '{}');
  END IF;
  SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.usage_execution_reservations'::regclass
     AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'AGCR postcondition: anon, authenticated and authenticator must hold nothing on the table, found %', v_leaked;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid = 'public.usage_execution_reservations'::regclass AND a.grantee = 0;
  IF v_n <> 0 THEN RAISE EXCEPTION 'AGCR postcondition: PUBLIC must hold no privilege on the table, found % grant(s)', v_n; END IF;

  FOREACH v_sig IN ARRAY v_fns LOOP
    v_fn := to_regprocedure(v_sig);
    IF v_fn IS NULL THEN RAISE EXCEPTION 'AGCR postcondition: % is missing', v_sig; END IF;
    SELECT p.prosecdef, p.proconfig, p.provolatile INTO v_secdef, v_config, v_vol FROM pg_proc p WHERE p.oid = v_fn;
    -- Both hashes DERIVE from the installed body (LF-normalised): the CRLF one is exercised too (05).
    IF NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL (SELECT replace(p.prosrc, E'\r\n', E'\n') AS lf) n
                  WHERE p.oid = v_fn AND md5(n.lf) = ((CASE v_sig
         WHEN 'public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text)' THEN ARRAY['f34b1c37b8f424a06f6dc723dbfa5394', '4e08ee3d38f39996358cead6597c1af5']
         WHEN 'public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer)' THEN ARRAY['6b248c44531b6d97d7137140e0d80ff2', 'f16e797f0f75345978d54ea1cf1e6c29']
         ELSE ARRAY['7757d352b546ccc7e6fac458b6b1577a', '621dcd59b9c30a76ad9e871efd8a34b8'] END))[1] AND md5(replace(n.lf, E'\n', E'\r\n')) = ((CASE v_sig
         WHEN 'public.community_ai_claim_within_limits(uuid, uuid, uuid, text, text, text, text)' THEN ARRAY['f34b1c37b8f424a06f6dc723dbfa5394', '4e08ee3d38f39996358cead6597c1af5']
         WHEN 'public.usage_execution_reserve(uuid, integer, integer, uuid, numeric, integer)' THEN ARRAY['6b248c44531b6d97d7137140e0d80ff2', 'f16e797f0f75345978d54ea1cf1e6c29']
         ELSE ARRAY['7757d352b546ccc7e6fac458b6b1577a', '621dcd59b9c30a76ad9e871efd8a34b8'] END))[2]) THEN
      RAISE EXCEPTION 'AGCR postcondition: the installed body of % does not match the hashes in this migration - update them with the body', v_sig;
    END IF;
    IF v_secdef THEN RAISE EXCEPTION 'AGCR postcondition: % must be SECURITY INVOKER', v_sig; END IF;
    IF v_vol <> 'v' THEN RAISE EXCEPTION 'AGCR postcondition: % must be VOLATILE', v_sig; END IF;
    IF v_config IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (v_config)) THEN
      RAISE EXCEPTION 'AGCR postcondition: % must pin search_path, found %', v_sig, v_config;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'AGCR postcondition: anon / authenticated must not EXECUTE %', v_sig;
    END IF;
    SELECT count(*) INTO v_n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF v_n <> 0 THEN RAISE EXCEPTION 'AGCR postcondition: PUBLIC must not EXECUTE % (proacl NULL means OPEN)', v_sig; END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'AGCR postcondition: service_role must EXECUTE %', v_sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'AGCR: community_ai_claim_within_limits + usage_execution_reserve/release installed; grants, RLS, volatility and search_path verified.';
END
$verify$;

COMMIT;
