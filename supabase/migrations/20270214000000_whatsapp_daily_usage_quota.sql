-- WhatsApp daily send limit: a real database fallback that fails CLOSED.
--
-- THE DEFECT THIS CLOSES (C10, 2026-11-11). The daily WhatsApp limit is enforced in
-- Redis, with a database fallback for when Redis is unavailable. That fallback never
-- worked:
--   - it READ api_provider_accounts.current_usage_day matched by
--     account_name = <social account id>. api_provider_accounts is the external-API
--     provider CREDENTIAL table (api_source_id NOT NULL); WhatsApp is not an external
--     API source and no row with such an account_name is ever created, so the read
--     found nothing and the usage was taken as 0;
--   - it INCREMENTED through rpc('increment_wa_usage'), a function that exists in no
--     environment, and the call's error was discarded.
-- So during a Redis outage every send was allowed: the limit failed OPEN.
--
-- THE REPLACEMENT. One table owned by this control, and one function that checks and
-- consumes the quota in a SINGLE statement:
--
-- p_usage_day is the caller's UTC date (WhatsApp's own daily window is UTC-aligned;
-- a local-time day would misalign at the boundary and over-permit). Taking it as a
-- parameter keeps the function free of time-zone opinion.
--
--   INSERT ... ON CONFLICT (social_account_id, usage_day) DO UPDATE
--     SET used = used + p_count WHERE used + p_count <= p_limit RETURNING used
--
-- A row is written only when the new total stays within the limit, so the check and
-- the increment cannot be separated by a concurrent caller (the old fallback was
-- check-then-increment). Under concurrency PostgreSQL re-evaluates the WHERE against
-- the row's latest version, so two callers can never both take the last unit. The
-- day is part of the key, so no reset job is needed (the old resetDailyCounters had
-- no caller and would have zeroed EVERY provider account's counter if wired).
--
-- The application calls only this function and treats ANY error, or a missing
-- answer, as "not allowed" (backend/services/whatsappRateLimiter.ts).
--
-- PRIVILEGES. service_role only: SELECT, INSERT, UPDATE on the table (what the
-- upsert needs) and EXECUTE on the function. anon, authenticated, authenticator and
-- PUBLIC hold nothing. The function is SECURITY INVOKER with a pinned search_path
-- (pg_catalog, public, pg_temp: pg_temp LAST, the repo convention, so a temporary
-- relation can never shadow a public one; every reference in the body is also
-- schema-qualified).
--
-- Re-runnable: every object is created IF NOT EXISTS or replaced in place, and the
-- postcondition block re-proves the end state on every replay.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.social_accounts') IS NULL THEN
    RAISE EXCEPTION 'WDU preflight: public.social_accounts is missing - there is no sender account to meter';
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'WDU preflight: auth.role() is missing - the house service_role policy cannot be expressed';
  END IF;
END
$preflight$;

-- ── 1. The usage table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_daily_usage (
  social_account_id uuid        NOT NULL
    CONSTRAINT whatsapp_daily_usage_account_fk
    REFERENCES public.social_accounts (id) ON DELETE CASCADE,
  usage_day         date        NOT NULL,
  used              integer     NOT NULL DEFAULT 0
    CONSTRAINT whatsapp_daily_usage_used_nonnegative CHECK (used >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_daily_usage_pkey PRIMARY KEY (social_account_id, usage_day)
);

COMMENT ON TABLE public.whatsapp_daily_usage IS
  'WhatsApp daily send usage per sender account (UTC day), the database fallback of '
  'the daily limit. Written ONLY by whatsapp_consume_daily_quota (atomic check-and-consume).';

-- ── 2. Exposure: RLS, one service_role policy, service_role only ───────────

ALTER TABLE public.whatsapp_daily_usage ENABLE ROW LEVEL SECURITY;

DO $wdu_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'whatsapp_daily_usage'
       AND policyname = 'whatsapp_daily_usage_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY whatsapp_daily_usage_service_role ON public.whatsapp_daily_usage;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'whatsapp_daily_usage'
       AND policyname = 'whatsapp_daily_usage_service_role'
  ) THEN
    CREATE POLICY whatsapp_daily_usage_service_role
      ON public.whatsapp_daily_usage
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$wdu_rls$;

REVOKE ALL ON TABLE public.whatsapp_daily_usage
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_daily_usage TO service_role;

-- ── 3. The check-and-consume function ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.whatsapp_consume_daily_quota(
  p_social_account_id uuid,
  p_usage_day         date,
  p_count             integer,
  p_limit             integer
)
RETURNS TABLE (allowed boolean, used integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_used integer;
BEGIN
  IF p_social_account_id IS NULL OR p_usage_day IS NULL OR p_count IS NULL OR p_limit IS NULL
     OR p_count < 1 OR p_limit < 0 THEN
    RAISE EXCEPTION 'whatsapp_consume_daily_quota: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- One statement: the row is written only when the new total stays within the limit.
  -- bigint arithmetic, so a total near the integer maximum cannot overflow the check.
  INSERT INTO public.whatsapp_daily_usage AS u (social_account_id, usage_day, used)
  SELECT p_social_account_id, p_usage_day, p_count
   WHERE p_count <= p_limit
  ON CONFLICT (social_account_id, usage_day) DO UPDATE
     SET used       = u.used + EXCLUDED.used,
         updated_at = now()
   WHERE u.used::bigint + EXCLUDED.used::bigint <= p_limit::bigint
  RETURNING u.used INTO v_used;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_used;
    RETURN;
  END IF;

  -- Refused: report the day's usage as it stands (0 when nothing was consumed yet).
  SELECT d.used INTO v_used
    FROM public.whatsapp_daily_usage d
   WHERE d.social_account_id = p_social_account_id AND d.usage_day = p_usage_day;
  RETURN QUERY SELECT false, coalesce(v_used, 0);
END
$fn$;

COMMENT ON FUNCTION public.whatsapp_consume_daily_quota(uuid, date, integer, integer) IS
  'Atomically consume p_count of the WhatsApp daily limit p_limit for one sender account '
  'and UTC day. allowed=false means nothing was consumed. The caller fails CLOSED on any error.';

REVOKE ALL ON FUNCTION public.whatsapp_consume_daily_quota(uuid, date, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_consume_daily_quota(uuid, date, integer, integer) TO service_role;

-- ── 4. Postconditions ───────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_rls       boolean;
  v_force     boolean;
  v_n         integer;
  v_pol_roles text[];
  v_priv      text[];
  v_leaked    text[];
  v_fn        regprocedure := to_regprocedure('public.whatsapp_consume_daily_quota(uuid, date, integer, integer)');
  v_secdef    boolean;
  v_config    text[];
BEGIN
  IF to_regclass('public.whatsapp_daily_usage') IS NULL THEN
    RAISE EXCEPTION 'WDU postcondition: the table is missing';
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.whatsapp_daily_usage'::regclass AND contype = 'p'
     AND conname = 'whatsapp_daily_usage_pkey'
     AND pg_get_constraintdef(oid) = 'PRIMARY KEY (social_account_id, usage_day)';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WDU postcondition: the primary key must be (social_account_id, usage_day)';
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.whatsapp_daily_usage'::regclass
     AND conname = 'whatsapp_daily_usage_account_fk' AND contype = 'f' AND confdeltype = 'c';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WDU postcondition: whatsapp_daily_usage_account_fk must reference social_accounts ON DELETE CASCADE';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'public.whatsapp_daily_usage'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'WDU postcondition: row level security must be ENABLED';
  END IF;
  IF v_force THEN
    RAISE EXCEPTION 'WDU postcondition: row level security must NOT be FORCED';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'whatsapp_daily_usage';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WDU postcondition: expected exactly 1 policy, found %', v_n;
  END IF;
  SELECT roles::text[] INTO v_pol_roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'whatsapp_daily_usage'
     AND policyname = 'whatsapp_daily_usage_service_role';
  IF v_pol_roles IS DISTINCT FROM ARRAY['service_role'] THEN
    RAISE EXCEPTION 'WDU postcondition: the policy must apply to exactly {service_role}, found %', v_pol_roles;
  END IF;

  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.whatsapp_daily_usage'::regclass AND r2.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['INSERT', 'SELECT', 'UPDATE'] THEN
    RAISE EXCEPTION 'WDU postcondition: service_role must hold exactly {INSERT,SELECT,UPDATE}, found %',
      coalesce(v_priv::text, '{}');
  END IF;

  SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.whatsapp_daily_usage'::regclass
     AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'WDU postcondition: anon, authenticated and authenticator must hold nothing on the table, found %', v_leaked;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid = 'public.whatsapp_daily_usage'::regclass AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WDU postcondition: PUBLIC must hold no privilege on the table, found % grant(s)', v_n;
  END IF;

  -- The function: present, INVOKER, search_path pinned, EXECUTE for service_role only.
  -- (A NULL proacl means PUBLIC may execute, so the ACL is read, never assumed.)
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'WDU postcondition: whatsapp_consume_daily_quota(uuid, date, integer, integer) is missing';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
  IF v_secdef THEN
    RAISE EXCEPTION 'WDU postcondition: whatsapp_consume_daily_quota must be SECURITY INVOKER';
  END IF;
  IF v_config IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (v_config)) THEN
    RAISE EXCEPTION 'WDU postcondition: whatsapp_consume_daily_quota must pin search_path=pg_catalog, public, pg_temp, found %',
      coalesce(v_config::text, '{}');
  END IF;

  SELECT array_agg(DISTINCT coalesce(r2.rolname, 'PUBLIC')) INTO v_leaked
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    LEFT JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE p.oid = v_fn AND a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR r2.rolname IN ('anon', 'authenticated', 'authenticator'));
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'WDU postcondition: EXECUTE must not be held by %', v_leaked;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) a
    JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE p.oid = v_fn AND a.privilege_type = 'EXECUTE' AND r2.rolname = 'service_role';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WDU postcondition: service_role must hold EXECUTE on whatsapp_consume_daily_quota';
  END IF;

  RAISE NOTICE 'WDU: whatsapp_daily_usage verified - PK (social_account_id, usage_day), FK social_accounts CASCADE; RLS enabled, not forced, 1 service_role policy; service_role SELECT+INSERT+UPDATE only; whatsapp_consume_daily_quota INVOKER, search_path pinned, EXECUTE service_role only.';
END
$verify$;

COMMIT;
