-- Outreach quota: an ATOMIC database layer for the WS-3 dispatch limiter (version 20270217000009,
-- reserved by virality-83; owner ruling via e9 2026-11-12, CLASS-2 D6 option 2; on fix/s-wa-combined).
--
-- WHY. leadOutreachExecution/quota.ts reserves one unit of the tenant / lead 24 h limit before a
-- dispatch. With Redis unusable it fell back to READING the durable attempt count and granting on
-- it: two dispatchers both read N-1 and both took the last unit - over the limit. A function that
-- only locks and counts cannot fix that: its lock ends with its own transaction, and the counted
-- truth (outreach_attempts) is written LATER, by a separate call (dispatch.ts: reserve ->
-- appendAttempt -> send). So the grant WRITES, under the lock: a reservation row that counts until
-- its attempt exists.
--
--   outreach_quota_consume  - under a per-tenant transaction advisory lock: used = attempts in the
--                             window + LIVE reservations; if under both limits, insert a reservation
--                             and return it. Atomic per tenant: a concurrent consume waits, then sees
--                             this reservation.
--   outreach_quota_release  - marks a reservation released (the dispatch did not proceed).
--
-- A reservation is LIVE while: not released, AND no attempt of its task started at/after it
-- (less ATTEMPT_CLOCK_MARGIN: started_at is written from the app clock, reserved_at from the
-- database's), AND younger than p_ttl_seconds - a dispatcher that crashed between the grant and its
-- attempt (and never released) frees its unit after the TTL instead of holding it for ever (e9).
-- Every mismatch errs toward COUNTING a reservation (refusing sooner), never toward a second grant.
--
-- TYPES follow the real schema: outreach_tasks/outreach_attempts.company_id are uuid (retyped by
-- 20261011000000_a3_outreach_person_anchor) and lead_id stays text, so the reservation's company_id and
-- p_company_id are uuid (a text company id here raised 42883 uuid = text on the CI-faithful replay).
--
-- Used ONLY when Redis is unusable; the Redis path is unchanged. The table holds no message
-- content: ids, tenant, lead and times.
--
-- GRANTS (owner rule; "class-wide revokes miss new tables" + "hosted Supabase gives service_role
-- ALL"): the table is REVOKEd from every client role and from service_role, then granted to
-- service_role exactly {SELECT, INSERT, UPDATE}; RLS enabled with a service_role-only policy; the
-- functions are SECURITY INVOKER, search_path pinned, EXECUTE revoked by full signature and granted
-- to service_role only. All of it is asserted below.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.outreach_attempts') IS NULL OR to_regclass('public.outreach_tasks') IS NULL THEN
    RAISE EXCEPTION 'OQAC preflight: public.outreach_attempts / public.outreach_tasks are missing (WS-3 is not installed)';
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'OQAC preflight: auth.role() is missing - the house service_role policy cannot be expressed';
  END IF;
  -- ROLLBACK SOUNDNESS (05 / e1 rule, e9 2026-11-12): the rollback drops the table and both functions,
  -- so this apply must PROVE none of them predates it: all absent (first apply) or all present EXACTLY
  -- as this migration makes them (a re-apply) - the table's column names, TYPES and NOT NULL, its FK,
  -- and each function's BODY (md5 of prosrc, LF or CRLF). to_reg* only: the casts raise on absence.
  IF (to_regclass('public.outreach_quota_reservations') IS NOT NULL
      OR to_regprocedure('public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)') IS NOT NULL
      OR to_regprocedure('public.outreach_quota_release(uuid, uuid)') IS NOT NULL)
     AND NOT (
      (SELECT array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
                        ORDER BY a.attname) FROM pg_attribute a
        WHERE a.attrelid = to_regclass('public.outreach_quota_reservations') AND a.attnum > 0 AND NOT a.attisdropped)
        = ARRAY['company_id uuid not null', 'id uuid not null', 'lead_id text not null', 'released_at timestamp with time zone',
                'reserved_at timestamp with time zone not null', 'task_id uuid not null']
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.outreach_quota_reservations')
                   AND conname = 'outreach_quota_reservations_task_fk')
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)') AND md5(p.prosrc) = ANY (ARRAY['3a9b03d037ec06dcb7d629bfba2e6aaf', '545c906bdc14c73939ef09ed414b0472']))
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.outreach_quota_release(uuid, uuid)') AND md5(p.prosrc) = ANY (ARRAY['1948085f49c1e2f1327a7009ecd23080', '8f6f658007ed9244878bedc63212e6c4']))) THEN
    RAISE EXCEPTION 'OQAC preflight: outreach_quota_reservations / outreach_quota_consume / outreach_quota_release partly exist or differ - they predate this migration; refusing (its rollback must never drop them)';
  END IF;
END
$preflight$;


CREATE TABLE IF NOT EXISTS public.outreach_quota_reservations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  lead_id     text        NOT NULL,
  task_id     uuid        NOT NULL
    CONSTRAINT outreach_quota_reservations_task_fk
    REFERENCES public.outreach_tasks (id) ON DELETE CASCADE,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outreach_quota_reservations_tenant_live
  ON public.outreach_quota_reservations (company_id, reserved_at) WHERE released_at IS NULL;

COMMENT ON TABLE public.outreach_quota_reservations IS
  'WS-3 outreach quota reservations of the DATABASE limiter layer (Redis unusable). Written ONLY by '
  'outreach_quota_consume / outreach_quota_release. A reservation counts until its attempt exists, '
  'it is released, or its TTL passes.';


ALTER TABLE public.outreach_quota_reservations ENABLE ROW LEVEL SECURITY;

DO $oqac_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'outreach_quota_reservations'
       AND policyname = 'outreach_quota_reservations_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY outreach_quota_reservations_service_role ON public.outreach_quota_reservations;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'outreach_quota_reservations'
       AND policyname = 'outreach_quota_reservations_service_role'
  ) THEN
    CREATE POLICY outreach_quota_reservations_service_role
      ON public.outreach_quota_reservations
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$oqac_rls$;

REVOKE ALL ON TABLE public.outreach_quota_reservations
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.outreach_quota_reservations TO service_role;


CREATE OR REPLACE FUNCTION public.outreach_quota_consume(
  p_company_id    uuid,
  p_lead_id       text,
  p_task_id       uuid,
  p_since         timestamptz,
  p_limit_tenant  integer,
  p_limit_lead    integer,
  p_ttl_seconds   integer
)
RETURNS TABLE (granted boolean, reservation_id uuid, tenant_used integer, lead_used integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  -- The attempt's started_at comes from the app clock; reserved_at from the database's.
  c_attempt_clock_margin CONSTANT interval := interval '60 seconds';
  v_live_after  timestamptz;
  v_tenant      integer;
  v_lead        integer;
  v_id          uuid;
BEGIN
  IF p_company_id IS NULL OR p_lead_id IS NULL OR p_task_id IS NULL OR p_since IS NULL
     OR p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400
     OR (p_limit_tenant IS NOT NULL AND p_limit_tenant < 0)
     OR (p_limit_lead   IS NOT NULL AND p_limit_lead   < 0) THEN
    RAISE EXCEPTION 'outreach_quota_consume: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- One tenant at a time: a concurrent consume for this tenant waits here, then counts our row.
  PERFORM pg_advisory_xact_lock(hashtextextended('ws3_outreach_quota:' || p_company_id::text, 0));

  v_live_after := greatest(p_since, now() - make_interval(secs => p_ttl_seconds));

  SELECT
    (SELECT count(*) FROM public.outreach_attempts a
      WHERE a.company_id = p_company_id AND a.started_at >= p_since)
  + (SELECT count(*) FROM public.outreach_quota_reservations r
      WHERE r.company_id = p_company_id AND r.released_at IS NULL AND r.reserved_at >= v_live_after
        AND NOT EXISTS (SELECT 1 FROM public.outreach_attempts a
                         WHERE a.company_id = r.company_id AND a.task_id = r.task_id
                           AND a.started_at >= r.reserved_at - c_attempt_clock_margin))
  INTO v_tenant;

  SELECT
    (SELECT count(*) FROM public.outreach_attempts a
       JOIN public.outreach_tasks t ON t.id = a.task_id AND t.company_id = a.company_id
      WHERE a.company_id = p_company_id AND t.lead_id = p_lead_id AND a.started_at >= p_since)
  + (SELECT count(*) FROM public.outreach_quota_reservations r
      WHERE r.company_id = p_company_id AND r.lead_id = p_lead_id
        AND r.released_at IS NULL AND r.reserved_at >= v_live_after
        AND NOT EXISTS (SELECT 1 FROM public.outreach_attempts a
                         WHERE a.company_id = r.company_id AND a.task_id = r.task_id
                           AND a.started_at >= r.reserved_at - c_attempt_clock_margin))
  INTO v_lead;

  IF (p_limit_tenant IS NOT NULL AND v_tenant + 1 > p_limit_tenant)
     OR (p_limit_lead IS NOT NULL AND v_lead + 1 > p_limit_lead) THEN
    RETURN QUERY SELECT false, NULL::uuid, v_tenant, v_lead;
    RETURN;
  END IF;

  INSERT INTO public.outreach_quota_reservations (company_id, lead_id, task_id)
  VALUES (p_company_id, p_lead_id, p_task_id)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, v_id, v_tenant + 1, v_lead + 1;
END
$fn$;

COMMENT ON FUNCTION public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer) IS
  'WS-3 database limiter layer: atomically (per-tenant advisory lock) count attempts + live '
  'reservations and, under both limits, write a reservation. granted=false writes nothing.';


CREATE OR REPLACE FUNCTION public.outreach_quota_release(
  p_reservation_id uuid,
  p_company_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF p_reservation_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'outreach_quota_release: invalid arguments' USING ERRCODE = '22023';
  END IF;
  UPDATE public.outreach_quota_reservations
     SET released_at = now()
   WHERE id = p_reservation_id AND company_id = p_company_id AND released_at IS NULL;
  RETURN FOUND;
END
$fn$;

COMMENT ON FUNCTION public.outreach_quota_release(uuid, uuid) IS
  'Release a WS-3 database-layer quota reservation whose dispatch did not proceed. true = released now.';


REVOKE ALL ON FUNCTION public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.outreach_quota_release(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_quota_release(uuid, uuid) TO service_role;


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
  v_fns       text[] := ARRAY[
    'public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)',
    'public.outreach_quota_release(uuid, uuid)'];
  v_sig       text;
BEGIN
  IF to_regclass('public.outreach_quota_reservations') IS NULL THEN
    RAISE EXCEPTION 'OQAC postcondition: the table is missing';
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.outreach_quota_reservations'::regclass
     AND conname = 'outreach_quota_reservations_task_fk' AND contype = 'f' AND confdeltype = 'c';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OQAC postcondition: outreach_quota_reservations_task_fk must reference outreach_tasks ON DELETE CASCADE';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'public.outreach_quota_reservations'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'OQAC postcondition: row level security must be ENABLED';
  END IF;
  IF v_force THEN
    RAISE EXCEPTION 'OQAC postcondition: row level security must NOT be FORCED';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'outreach_quota_reservations';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OQAC postcondition: expected exactly 1 policy, found %', v_n;
  END IF;
  SELECT roles::text[] INTO v_pol_roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'outreach_quota_reservations'
     AND policyname = 'outreach_quota_reservations_service_role';
  IF v_pol_roles IS DISTINCT FROM ARRAY['service_role'] THEN
    RAISE EXCEPTION 'OQAC postcondition: the policy must apply to exactly {service_role}, found %', v_pol_roles;
  END IF;

  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.outreach_quota_reservations'::regclass AND r2.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['INSERT', 'SELECT', 'UPDATE'] THEN
    RAISE EXCEPTION 'OQAC postcondition: service_role must hold exactly {INSERT,SELECT,UPDATE}, found %', coalesce(v_priv::text, '{}');
  END IF;

  SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.outreach_quota_reservations'::regclass
     AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'OQAC postcondition: anon, authenticated and authenticator must hold nothing on the table, found %', v_leaked;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid = 'public.outreach_quota_reservations'::regclass AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'OQAC postcondition: PUBLIC must hold no privilege on the table, found % grant(s)', v_n;
  END IF;

  FOREACH v_sig IN ARRAY v_fns LOOP
    v_fn := to_regprocedure(v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'OQAC postcondition: % is missing', v_sig;
    END IF;
    SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
    -- The installed body matches the hashes this migration pins (both DERIVED from it, LF-normalised).
    IF NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL (SELECT replace(p.prosrc, E'\r\n', E'\n') AS lf) n
                  WHERE p.oid = v_fn AND md5(n.lf) = ((CASE v_sig WHEN 'public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)' THEN ARRAY['3a9b03d037ec06dcb7d629bfba2e6aaf', '545c906bdc14c73939ef09ed414b0472'] ELSE ARRAY['1948085f49c1e2f1327a7009ecd23080', '8f6f658007ed9244878bedc63212e6c4'] END))[1] AND md5(replace(n.lf, E'\n', E'\r\n')) = ((CASE v_sig WHEN 'public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)' THEN ARRAY['3a9b03d037ec06dcb7d629bfba2e6aaf', '545c906bdc14c73939ef09ed414b0472'] ELSE ARRAY['1948085f49c1e2f1327a7009ecd23080', '8f6f658007ed9244878bedc63212e6c4'] END))[2]) THEN
      RAISE EXCEPTION 'OQAC postcondition: the installed body of % does not match the hashes in this migration - update them with the body', v_sig;
    END IF;
    IF v_secdef THEN
      RAISE EXCEPTION 'OQAC postcondition: % must be SECURITY INVOKER', v_sig;
    END IF;
    IF v_config IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (v_config)) THEN
      RAISE EXCEPTION 'OQAC postcondition: % must pin search_path, found %', v_sig, v_config;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'OQAC postcondition: anon / authenticated must not EXECUTE %', v_sig;
    END IF;
    SELECT count(*) INTO v_n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'OQAC postcondition: PUBLIC must not EXECUTE % (proacl NULL means OPEN)', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'OQAC postcondition: service_role must EXECUTE %', v_sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'OQAC: outreach_quota_reservations + consume/release installed; grants, RLS and search_path verified.';
END
$verify$;

COMMIT;
