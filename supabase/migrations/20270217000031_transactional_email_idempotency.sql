-- Transactional email idempotency (version 20270217000031, reserved by virality-83; correct-sending, pre-launch;
-- e9 rulings 2026-11-13: reserve-first, TTL per email type decided server-side, stale 'sending' -> 'uncertain').
--
-- WHY. send-transactional-email IGNORED the `idempotencyKey` its callers pass, and kept no record of sends, so every
-- keyed caller (reinvite, company referral, inbound signup notice, credit alerts, and the outreach transport's
-- `duplicate` flag) believed its email was deduplicated and it was not. The function now reserves the key here
-- BEFORE it sends, and only the call that reserved it sends.
--
--   transactional_email_reserve       - atomic: an expired 'sent' row is removed (its window is over), then
--                                       INSERT ... ON CONFLICT DO NOTHING; the inserter gets 'reserved'. Otherwise:
--                                       'duplicate_sent' (+ its message id) / 'duplicate_uncertain' / a 'sending'
--                                       row older than p_stale_seconds becomes 'uncertain' ('stale_marked_uncertain':
--                                       a crashed send, never resent) / else 'duplicate_inflight'.
--   transactional_email_confirm       - 'sending' -> 'sent' + provider message id.
--   transactional_email_release       - deletes a 'sending' reservation after a DEFINITE failure (retryable).
--   transactional_email_mark_uncertain- 'sending' -> 'uncertain' (the provider may have it: never resent).
-- confirm / release / mark_uncertain move ONLY a 'sending' row: an 'uncertain' or 'sent' row is never reopened.
--
-- PRIVACY: no recipient address is stored - only recipient_sha256 (normalised address). No message content.
-- GRANTS (owner rules; "class-wide revokes miss new tables" + "hosted Supabase gives service_role ALL"): the table is
-- REVOKEd from every client role and from service_role, then granted to service_role exactly {SELECT, INSERT, UPDATE,
-- DELETE}; RLS enabled with a service_role-only policy; the functions are SECURITY INVOKER, search_path pinned,
-- EXECUTE revoked by full signature and granted to service_role only. All of it is asserted below.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'TEI preflight: auth.role() is missing - the house service_role policy cannot be expressed';
  END IF;
  -- ROLLBACK SOUNDNESS (05 / e1 rule): the rollback drops the table and the four functions, so this apply must
  -- PROVE none of them predates it - all absent (first apply) or all present exactly as this migration makes them
  -- (a re-apply): the table's columns (name, type, NOT NULL) and each function's BODY (md5 of prosrc, LF or CRLF).
  IF (to_regclass('public.transactional_email_sends') IS NOT NULL
      OR to_regprocedure('public.transactional_email_reserve(text, text, text, integer, integer)') IS NOT NULL
      OR to_regprocedure('public.transactional_email_confirm(text, text)') IS NOT NULL
      OR to_regprocedure('public.transactional_email_release(text)') IS NOT NULL
      OR to_regprocedure('public.transactional_email_mark_uncertain(text, text)') IS NOT NULL)
     AND NOT (
      (SELECT array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
                        ORDER BY a.attname) FROM pg_attribute a
        WHERE a.attrelid = to_regclass('public.transactional_email_sends') AND a.attnum > 0 AND NOT a.attisdropped)
        = ARRAY['created_at timestamp with time zone not null', 'email_type text not null', 'expires_at timestamp with time zone not null',
                'idempotency_key text not null', 'provider_message_id text', 'recipient_sha256 text not null', 'state text not null',
                'uncertain_reason text', 'updated_at timestamp with time zone not null']
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.transactional_email_reserve(text, text, text, integer, integer)') AND md5(p.prosrc) = ANY (ARRAY['032d483f269d93f18419076c9fcc058f', '63be595cb0bf7c87eb2931a196d65f97']))
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.transactional_email_confirm(text, text)') AND md5(p.prosrc) = ANY (ARRAY['dd94f25060b15b16d83d6a1a51241141', '8f80ea2ba4fcb8b1f80c24705df58f5c']))
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.transactional_email_release(text)') AND md5(p.prosrc) = ANY (ARRAY['d616620ce4527f7e04026583d5347ecd', '54360828a49752d8430a88847b2b4979']))
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.transactional_email_mark_uncertain(text, text)') AND md5(p.prosrc) = ANY (ARRAY['4248a58f329ea5c2036c56c74439b7c6', 'c07c4e1751745107a4a027a6aef6b4ab']))) THEN
    RAISE EXCEPTION 'TEI preflight: transactional_email_sends / its functions partly exist or differ - they predate this migration; refusing (its rollback must never drop them)';
  END IF;
END
$preflight$;


CREATE TABLE IF NOT EXISTS public.transactional_email_sends (
  idempotency_key     text        PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 1 AND 512),
  email_type          text        NOT NULL CHECK (length(email_type) BETWEEN 1 AND 100),
  recipient_sha256    text        NOT NULL CHECK (recipient_sha256 ~ '^[0-9a-f]{64}$'),
  state               text        NOT NULL CHECK (state IN ('sending', 'sent', 'uncertain')),
  provider_message_id text,
  uncertain_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL
);

-- Ops: uncertain and stuck sends are the rows a person must look at.
CREATE INDEX IF NOT EXISTS idx_transactional_email_sends_open
  ON public.transactional_email_sends (state, created_at) WHERE state IN ('sending', 'uncertain');

COMMENT ON TABLE public.transactional_email_sends IS
  'Idempotency ledger of send-transactional-email: one row per caller idempotency key. Written ONLY by the '
  'transactional_email_* functions. No recipient address (recipient_sha256 only), no content.';

ALTER TABLE public.transactional_email_sends ENABLE ROW LEVEL SECURITY;

DO $tei_rls$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactional_email_sends'
               AND policyname = 'transactional_email_sends_service_role' AND roles::text[] <> ARRAY['service_role']) THEN
    DROP POLICY transactional_email_sends_service_role ON public.transactional_email_sends;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactional_email_sends'
                   AND policyname = 'transactional_email_sends_service_role') THEN
    CREATE POLICY transactional_email_sends_service_role ON public.transactional_email_sends
      FOR ALL TO service_role USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$tei_rls$;

REVOKE ALL ON TABLE public.transactional_email_sends FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transactional_email_sends TO service_role;


CREATE OR REPLACE FUNCTION public.transactional_email_reserve(
  p_key              text,
  p_email_type       text,
  p_recipient_sha256 text,
  p_ttl_seconds      integer,
  p_stale_seconds    integer
)
RETURNS TABLE (outcome text, message_id text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_row      public.transactional_email_sends%ROWTYPE;
  v_inserted integer;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 512 OR p_email_type IS NULL OR p_recipient_sha256 IS NULL
     OR p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 40 * 86400
     OR p_stale_seconds IS NULL OR p_stale_seconds < 60 OR p_stale_seconds > 86400 THEN
    RAISE EXCEPTION 'transactional_email_reserve: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- A 'sent' row whose window is over no longer deduplicates: remove it, so the INSERT below can reserve anew.
  -- An 'uncertain' row is NEVER removed here (the provider may have the message).
  DELETE FROM public.transactional_email_sends
   WHERE idempotency_key = p_key AND state = 'sent' AND expires_at <= now();

  INSERT INTO public.transactional_email_sends (idempotency_key, email_type, recipient_sha256, state, expires_at)
  VALUES (p_key, p_email_type, p_recipient_sha256, 'sending', now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN QUERY SELECT 'reserved'::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.transactional_email_sends WHERE idempotency_key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    -- Released between our INSERT and this read: someone else is deciding it right now - retry later.
    RETURN QUERY SELECT 'duplicate_inflight'::text, NULL::text;
    RETURN;
  END IF;
  IF v_row.state = 'sent' THEN
    RETURN QUERY SELECT 'duplicate_sent'::text, v_row.provider_message_id;
    RETURN;
  END IF;
  IF v_row.state = 'uncertain' THEN
    RETURN QUERY SELECT 'duplicate_uncertain'::text, NULL::text;
    RETURN;
  END IF;
  IF v_row.created_at < now() - make_interval(secs => p_stale_seconds) THEN
    UPDATE public.transactional_email_sends
       SET state = 'uncertain', uncertain_reason = 'stale_sending_reservation', updated_at = now()
     WHERE idempotency_key = p_key AND state = 'sending';
    RETURN QUERY SELECT 'stale_marked_uncertain'::text, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'duplicate_inflight'::text, NULL::text;
END
$fn$;

CREATE OR REPLACE FUNCTION public.transactional_email_confirm(p_key text, p_message_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  UPDATE public.transactional_email_sends
     SET state = 'sent', provider_message_id = p_message_id, updated_at = now()
   WHERE idempotency_key = p_key AND state = 'sending';
  RETURN FOUND;
END
$fn$;

CREATE OR REPLACE FUNCTION public.transactional_email_release(p_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  DELETE FROM public.transactional_email_sends WHERE idempotency_key = p_key AND state = 'sending';
  RETURN FOUND;
END
$fn$;

CREATE OR REPLACE FUNCTION public.transactional_email_mark_uncertain(p_key text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  UPDATE public.transactional_email_sends
     SET state = 'uncertain', uncertain_reason = left(coalesce(p_reason, 'unknown'), 500), updated_at = now()
   WHERE idempotency_key = p_key AND state = 'sending';
  RETURN FOUND;
END
$fn$;

REVOKE ALL ON FUNCTION public.transactional_email_reserve(text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactional_email_reserve(text, text, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.transactional_email_confirm(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactional_email_confirm(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.transactional_email_release(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactional_email_release(text) TO service_role;
REVOKE ALL ON FUNCTION public.transactional_email_mark_uncertain(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactional_email_mark_uncertain(text, text) TO service_role;


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
  v_sig       text;
  v_hashes    text[];
  v_fns       text[] := ARRAY[
    'public.transactional_email_reserve(text, text, text, integer, integer)',
    'public.transactional_email_confirm(text, text)',
    'public.transactional_email_release(text)',
    'public.transactional_email_mark_uncertain(text, text)'];
BEGIN
  IF to_regclass('public.transactional_email_sends') IS NULL THEN
    RAISE EXCEPTION 'TEI postcondition: the table is missing';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'public.transactional_email_sends'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'TEI postcondition: row level security must be ENABLED'; END IF;
  IF v_force THEN RAISE EXCEPTION 'TEI postcondition: row level security must NOT be FORCED'; END IF;

  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactional_email_sends';
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEI postcondition: expected exactly 1 policy, found %', v_n; END IF;
  SELECT roles::text[] INTO v_pol_roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'transactional_email_sends' AND policyname = 'transactional_email_sends_service_role';
  IF v_pol_roles IS DISTINCT FROM ARRAY['service_role'] THEN
    RAISE EXCEPTION 'TEI postcondition: the policy must apply to exactly {service_role}, found %', v_pol_roles;
  END IF;

  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.transactional_email_sends'::regclass AND r2.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'] THEN
    RAISE EXCEPTION 'TEI postcondition: service_role must hold exactly {DELETE,INSERT,SELECT,UPDATE}, found %', coalesce(v_priv::text, '{}');
  END IF;
  SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.transactional_email_sends'::regclass AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'TEI postcondition: anon, authenticated and authenticator must hold nothing on the table, found %', v_leaked;
  END IF;
  SELECT count(*) INTO v_n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid = 'public.transactional_email_sends'::regclass AND a.grantee = 0;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEI postcondition: PUBLIC must hold no privilege on the table, found % grant(s)', v_n; END IF;

  FOREACH v_sig IN ARRAY v_fns LOOP
    v_fn := to_regprocedure(v_sig);
    IF v_fn IS NULL THEN RAISE EXCEPTION 'TEI postcondition: % is missing', v_sig; END IF;
    v_hashes := CASE v_sig
      WHEN 'public.transactional_email_reserve(text, text, text, integer, integer)' THEN ARRAY['032d483f269d93f18419076c9fcc058f', '63be595cb0bf7c87eb2931a196d65f97']
      WHEN 'public.transactional_email_confirm(text, text)' THEN ARRAY['dd94f25060b15b16d83d6a1a51241141', '8f80ea2ba4fcb8b1f80c24705df58f5c']
      WHEN 'public.transactional_email_release(text)' THEN ARRAY['d616620ce4527f7e04026583d5347ecd', '54360828a49752d8430a88847b2b4979']
      ELSE ARRAY['4248a58f329ea5c2036c56c74439b7c6', 'c07c4e1751745107a4a027a6aef6b4ab'] END;
    -- The installed body matches the hashes this migration pins (both DERIVED from it, LF-normalised).
    IF NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL (SELECT replace(p.prosrc, E'\r\n', E'\n') AS lf) n
                    WHERE p.oid = v_fn AND md5(n.lf) = v_hashes[1] AND md5(replace(n.lf, E'\n', E'\r\n')) = v_hashes[2]) THEN
      RAISE EXCEPTION 'TEI postcondition: the installed body of % does not match the hashes in this migration - update them with the body', v_sig;
    END IF;
    SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
    IF v_secdef THEN RAISE EXCEPTION 'TEI postcondition: % must be SECURITY INVOKER', v_sig; END IF;
    IF v_config IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (v_config)) THEN
      RAISE EXCEPTION 'TEI postcondition: % must pin search_path, found %', v_sig, v_config;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEI postcondition: anon / authenticated must not EXECUTE %', v_sig;
    END IF;
    SELECT count(*) INTO v_n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF v_n <> 0 THEN RAISE EXCEPTION 'TEI postcondition: PUBLIC must not EXECUTE % (proacl NULL means OPEN)', v_sig; END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEI postcondition: service_role must EXECUTE %', v_sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'TEI: transactional_email_sends + reserve/confirm/release/mark_uncertain installed; grants, RLS and search_path verified.';
END
$verify$;

COMMIT;
