-- 20270217000017 - credit admin-grant velocity cap, ATOMIC (M5; e1; e9-approved BLOCKING money 2026-11-13; version
-- reassigned to e1 by virality-83 in 8f3104784; review: virality-05).
--
-- WHY. backend/services/creditAdminGrantService.ts enforced "3 admin grants per org per 24h" as count-then-act, in four
-- separate steps: count credit_admin_grants -> createCredit (ledger) -> insert the audit row. Defects:
--   (a) concurrent grants all read a count under the limit and all pass;
--   (b) the count's error was turned into 0 (fail-open);
--   (c) the ledger was credited BEFORE the audit row the cap counts, and an audit-insert failure was swallowed - a grant
--       with no counted row makes the cap under-count permanently, and the two can never be reconciled afterwards;
--   (d) the idempotency key was a MINUTE BUCKET: two distinct grants in one minute collapsed into one, and a retry across a
--       minute boundary granted twice. A key must name the OBJECT (this grant request), never a clock bucket.
--
-- WHAT. public.admin_grant_credits(...) - ONE transaction that
--   1. requires a caller key per grant request (the route passes the request's Idempotency-Key) -> ledger/audit key
--      'admin_grant:<org>:<client_key>'; a replay of the same key returns the existing grant (and refuses if the same key
--      is reused for a DIFFERENT org or amount);
--   2. takes a transaction-scoped advisory lock per ORG, so concurrent grants for one org serialise;
--   3. counts that org's grants in the rolling last 24h and refuses GRANT_LIMIT_EXCEEDED at the cap unless the caller
--      passes the audited escalation override;
--   4. credits the ledger through public.apply_credit_reservation('grant', paid) AND writes the credit_admin_grants row
--      in the SAME transaction - either both exist or neither does.
--   INVOKER rights (callers are service_role, which already holds every privilege needed - no escalation), search_path
--   pinned, EXECUTE for service_role only. Authorization (super-admin + the approval chain) stays in the route.
--   The cap value comes from the caller (ADMIN_GRANT_MAX_PER_DAY, one TS definition), floor-checked here.
-- IDEMPOTENT: CREATE OR REPLACE.

DO $preflight$
BEGIN
  IF to_regclass('public.credit_admin_grants') IS NULL THEN
    RAISE EXCEPTION '017 preflight: public.credit_admin_grants does not exist';
  END IF;
  -- reason_type / expires_at come from 20260514_enhance_one_time_credits, a collision-era version: assert, never assume.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_admin_grants'
        AND column_name IN ('organization_id', 'granted_by_user_id', 'credits_granted', 'reason', 'reason_type',
                            'expires_at', 'idempotency_key', 'metadata', 'created_at')) <> 9 THEN
    RAISE EXCEPTION '017 preflight: credit_admin_grants is missing a column the grant writes (reason_type / expires_at come from 20260514)';
  END IF;
  IF to_regprocedure('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION '017 preflight: public.apply_credit_reservation is missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.admin_grant_credits(
  p_org_id           uuid,
  p_actor_user_id    uuid,
  p_credits          int,
  p_reason           text,
  p_reason_type      text,
  p_expires_at       timestamptz,
  p_client_key       text,
  p_max_per_24h      int,
  p_allow_over_limit boolean DEFAULT false,
  p_metadata         jsonb   DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key      text;
  v_existing public.credit_admin_grants%ROWTYPE;
  v_recent   int;
  v_ledger   jsonb;
  v_grant_id uuid;
BEGIN
  IF p_org_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_GRANT_MISSING_ARGUMENT' USING ERRCODE = 'P0001';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'ADMIN_GRANT_INVALID_CREDITS: %', p_credits USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'ADMIN_GRANT_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_client_key IS NULL OR btrim(p_client_key) = '' THEN
    RAISE EXCEPTION 'ADMIN_GRANT_CLIENT_KEY_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_per_24h IS NULL OR p_max_per_24h < 1 THEN
    RAISE EXCEPTION 'ADMIN_GRANT_INVALID_LIMIT: %', p_max_per_24h USING ERRCODE = 'P0001';
  END IF;

  v_key := 'admin_grant:' || p_org_id::text || ':' || btrim(p_client_key);

  -- Serialise every grant for this org for the rest of the transaction (count + ledger + audit are one unit).
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_grant:' || p_org_id::text, 0));

  -- Replay of the SAME grant request: return it; the same key for a different grant is a caller bug, refused.
  SELECT * INTO v_existing FROM public.credit_admin_grants WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.organization_id <> p_org_id OR v_existing.credits_granted <> p_credits THEN
      RAISE EXCEPTION 'ADMIN_GRANT_KEY_REUSED: key % already granted % credits to org %',
        v_key, v_existing.credits_granted, v_existing.organization_id USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('replayed', true, 'grant_id', v_existing.id, 'idempotency_key', v_key,
      'credits', v_existing.credits_granted, 'expires_at', v_existing.expires_at);
  END IF;

  SELECT count(*) INTO v_recent FROM public.credit_admin_grants
   WHERE organization_id = p_org_id AND created_at > now() - interval '24 hours';
  IF v_recent >= p_max_per_24h AND NOT coalesce(p_allow_over_limit, false) THEN
    RAISE EXCEPTION 'GRANT_LIMIT_EXCEEDED: % admin grant(s) for org % in the last 24h (limit %)',
      v_recent, p_org_id, p_max_per_24h USING ERRCODE = 'P0001';
  END IF;

  v_ledger := public.apply_credit_reservation(
    p_org_id, 'grant', 0, 0, p_credits, v_key, 'admin_extension', NULL,
    'Admin credit extension (' || coalesce(p_reason_type, 'other') || '): ' || p_reason, p_actor_user_id, NULL, 'paid');

  INSERT INTO public.credit_admin_grants
    (organization_id, granted_by_user_id, credits_granted, reason, reason_type, expires_at, idempotency_key, metadata)
  VALUES
    (p_org_id, p_actor_user_id, p_credits, p_reason, coalesce(p_reason_type, 'other'), p_expires_at, v_key,
     coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
       'allow_over_limit', coalesce(p_allow_over_limit, false),
       'grants_in_last_24h_before', v_recent,
       'ledger_transaction_id', v_ledger->>'id'))
  RETURNING id INTO v_grant_id;

  RETURN jsonb_build_object('replayed', false, 'grant_id', v_grant_id, 'idempotency_key', v_key, 'credits', p_credits,
    'expires_at', p_expires_at, 'over_limit', v_recent >= p_max_per_24h, 'ledger_transaction_id', v_ledger->>'id');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_credits(uuid, uuid, int, text, text, timestamptz, text, int, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_credits(uuid, uuid, int, text, text, timestamptz, text, int, boolean, jsonb)
  TO service_role;

DO $verify$
DECLARE
  r text;
  f constant text := 'public.admin_grant_credits(uuid, uuid, integer, text, text, timestamp with time zone, text, integer, boolean, jsonb)';
BEGIN
  IF to_regprocedure(f) IS NULL THEN
    RAISE EXCEPTION '017 postcondition: admin_grant_credits is missing';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN
    RAISE EXCEPTION '017 postcondition: admin_grant_credits must be INVOKER rights';
  END IF;
  IF NOT (SELECT proconfig @> ARRAY['search_path=pg_catalog, public'] FROM pg_proc WHERE oid = to_regprocedure(f)) THEN
    RAISE EXCEPTION '017 postcondition: admin_grant_credits search_path is not pinned';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION '017 postcondition: % can execute admin_grant_credits', r;
    END IF;
  END LOOP;
END
$verify$;

-- ROLLBACK: supabase/migrations/rollbacks/admin_grant_velocity_cap_rollback.sql
