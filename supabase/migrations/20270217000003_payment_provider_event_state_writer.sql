-- 20270217000003_payment_provider_event_state_writer
--
-- e9 ruling (2026-11-12, design (a)-(d) APPROVED). payment_provider_events is an
-- IMMUTABLE ledger (BEFORE UPDATE/DELETE raise_ledger_immutable). The app UPDATEd
-- it for every state change (Stripe markEvent, Razorpay markProviderEvent and
-- the rejected path) and for Razorpay enrichment (provider_mode, signature,
-- order/payment ids, beta tags) - every one of those writes was REFUSED and none
-- read its error, so event state and enrichment were silently lost. (C18: 0
-- events in prod today - the webhook path has never written one.)
-- 20260663 already built the 1:1 UPDATEable side table payment_provider_event_state
-- and advance_payment_provider_event_state(), never adopted by the app; that RPC
-- has NO state machine (any status overwrites any other). It is LEFT UNTOUCHED.
--
-- THIS MIGRATION ADDS (nothing applied is edited; the ledger trigger is untouched):
--  1. advance_payment_provider_event_state_guarded(event_id, status, error) - the
--     state writer the app uses. FORWARD-ONLY:
--        recorded -> processed | duplicate | failed
--        failed   -> requeued | failed (a repeated failure: error refreshed)
--        requeued -> processed | failed
--        processed, duplicate: TERMINAL (a late failure after success is a
--        log/metric in the app, never state - e9).
--     A disallowed transition changes NOTHING and returns {applied:false,
--     current}. An unknown event RAISES PAYMENT_EVENT_NOT_FOUND. 'ignored' is not
--     a status (e9): the app records an ignored event as 'processed' + reason.
--     Serialised per event by FOR UPDATE on its state row.
--  2. payment_provider_event_attributes - a NEW 1:1 side table for the enrichment
--     the ledger row cannot take after insert, with an index on
--     (provider, provider_order_id) so order-id lookups work.
--  3. set_payment_provider_event_attributes(event_id, attrs jsonb) - SET-IF-NULL:
--     a value, once written, is never overwritten (COALESCE(existing, new)).
-- Both functions: SECURITY INVOKER, search_path pinned, EXECUTE service_role only.
-- New table (the new-table lesson): RLS ON, REVOKE ALL FROM PUBLIC/anon/
-- authenticated, explicit service_role grant - all ASSERTED below.
--
-- PRECONDITION: the new table is ABSENT (to_regclass - 83), and both new
-- functions are either both absent (fresh) or both present (re-run); the
-- 20260663 side table exists.
-- POSTCONDITION: table + RLS + grants as stated; functions INVOKER, pinned,
-- no client EXECUTE.
-- Rollback: rollbacks/payment_provider_event_state_writer_rollback.sql - sound by
-- PROVENANCE (all three object names originate here); REFUSES while the
-- attributes table holds rows (a DROP would destroy written data).
-- GOV-SECURITY: virality-83; review: virality-05.

DO $pre$
DECLARE n int;
BEGIN
  IF to_regclass('public.payment_provider_event_state') IS NULL THEN
    RAISE EXCEPTION 'payment_provider_event_state_writer: payment_provider_event_state (20260663) is missing - nothing changed';
  END IF;
  SELECT (CASE WHEN to_regprocedure('public.advance_payment_provider_event_state_guarded(uuid,text,text)') IS NULL THEN 0 ELSE 1 END)
       + (CASE WHEN to_regprocedure('public.set_payment_provider_event_attributes(uuid,jsonb)') IS NULL THEN 0 ELSE 1 END)
       + (CASE WHEN to_regclass('public.payment_provider_event_attributes') IS NULL THEN 0 ELSE 1 END)
    INTO n;
  IF n NOT IN (0, 3) THEN
    RAISE EXCEPTION 'payment_provider_event_state_writer: % of 3 objects already exist (a partial earlier attempt) - inspect them; nothing changed', n;
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.payment_provider_event_attributes (
  provider_event_pk          uuid PRIMARY KEY REFERENCES public.payment_provider_events(id) ON DELETE RESTRICT,
  provider                   text NOT NULL,
  provider_mode              text,
  signature_valid            boolean,
  signature_algorithm        text,
  provider_order_id          text,
  provider_payment_id        text,
  beta_cohort                text,
  beta_access_level          text,
  monetization_beta_enabled  boolean,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ppe_attributes_order
  ON public.payment_provider_event_attributes (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

ALTER TABLE public.payment_provider_event_attributes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_provider_event_attributes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_provider_event_attributes TO service_role;

CREATE OR REPLACE FUNCTION public.advance_payment_provider_event_state_guarded(
  p_event_id uuid,
  p_status   text,
  p_error    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_cur text;
  v_ok  boolean;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('processed', 'duplicate', 'failed', 'requeued') THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_STATUS_INVALID' USING ERRCODE = 'P0001', DETAIL = format('status %L is not a target state', p_status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_provider_events e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = format('event %s', p_event_id);
  END IF;

  INSERT INTO public.payment_provider_event_state (provider_event_pk, processing_status)
  VALUES (p_event_id, 'recorded')
  ON CONFLICT (provider_event_pk) DO NOTHING;

  SELECT s.processing_status INTO v_cur
    FROM public.payment_provider_event_state s
   WHERE s.provider_event_pk = p_event_id
   FOR UPDATE;

  v_ok := CASE v_cur
    WHEN 'recorded' THEN p_status IN ('processed', 'duplicate', 'failed')
    WHEN 'failed'   THEN p_status IN ('requeued', 'failed')
    WHEN 'requeued' THEN p_status IN ('processed', 'failed')
    ELSE false            -- processed, duplicate: TERMINAL
  END;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('applied', false, 'current', v_cur, 'requested', p_status);
  END IF;

  UPDATE public.payment_provider_event_state
     SET processing_status = p_status,
         processed_at = CASE WHEN p_status IN ('processed', 'duplicate') THEN now() ELSE processed_at END,
         error_message = CASE WHEN p_status IN ('failed') THEN p_error
                              WHEN p_status = 'processed' THEN p_error  -- e.g. 'ignored:<reason>'
                              ELSE error_message END,
         retry_count = retry_count + CASE WHEN p_status = 'requeued' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE provider_event_pk = p_event_id;

  RETURN jsonb_build_object('applied', true, 'previous', v_cur, 'current', p_status);
END
$fn$;

CREATE OR REPLACE FUNCTION public.set_payment_provider_event_attributes(
  p_event_id uuid,
  p_attrs    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_provider text;
BEGIN
  SELECT e.provider INTO v_provider FROM public.payment_provider_events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_NOT_FOUND' USING ERRCODE = 'P0001', DETAIL = format('event %s', p_event_id);
  END IF;
  INSERT INTO public.payment_provider_event_attributes AS a (
    provider_event_pk, provider, provider_mode, signature_valid, signature_algorithm,
    provider_order_id, provider_payment_id, beta_cohort, beta_access_level, monetization_beta_enabled)
  VALUES (
    p_event_id, v_provider, p_attrs->>'provider_mode', (p_attrs->>'signature_valid')::boolean, p_attrs->>'signature_algorithm',
    p_attrs->>'provider_order_id', p_attrs->>'provider_payment_id', p_attrs->>'beta_cohort', p_attrs->>'beta_access_level',
    (p_attrs->>'monetization_beta_enabled')::boolean)
  ON CONFLICT (provider_event_pk) DO UPDATE SET
    -- SET-IF-NULL: a value, once written, is never overwritten.
    provider_mode             = COALESCE(a.provider_mode, EXCLUDED.provider_mode),
    signature_valid           = COALESCE(a.signature_valid, EXCLUDED.signature_valid),
    signature_algorithm       = COALESCE(a.signature_algorithm, EXCLUDED.signature_algorithm),
    provider_order_id         = COALESCE(a.provider_order_id, EXCLUDED.provider_order_id),
    provider_payment_id       = COALESCE(a.provider_payment_id, EXCLUDED.provider_payment_id),
    beta_cohort               = COALESCE(a.beta_cohort, EXCLUDED.beta_cohort),
    beta_access_level         = COALESCE(a.beta_access_level, EXCLUDED.beta_access_level),
    monetization_beta_enabled = COALESCE(a.monetization_beta_enabled, EXCLUDED.monetization_beta_enabled),
    updated_at                = now();
  RETURN jsonb_build_object('applied', true);
END
$fn$;

REVOKE ALL ON FUNCTION public.advance_payment_provider_event_state_guarded(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_payment_provider_event_attributes(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_payment_provider_event_state_guarded(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_payment_provider_event_attributes(uuid, jsonb) TO service_role;

DO $post$
DECLARE fn text; r text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_provider_event_attributes'::regclass) THEN
    RAISE EXCEPTION 'payment_provider_event_state_writer: postcondition failed - RLS is not enabled on the attributes table';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.payment_provider_event_attributes', 'SELECT')
       OR has_table_privilege(r, 'public.payment_provider_event_attributes', 'INSERT')
       OR has_table_privilege(r, 'public.payment_provider_event_attributes', 'UPDATE')
       OR has_table_privilege(r, 'public.payment_provider_event_attributes', 'DELETE') THEN
      RAISE EXCEPTION 'payment_provider_event_state_writer: postcondition failed - % holds a privilege on the attributes table', r;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.payment_provider_event_attributes', 'INSERT') THEN
    RAISE EXCEPTION 'payment_provider_event_state_writer: postcondition failed - service_role cannot write the attributes table';
  END IF;
  FOREACH fn IN ARRAY ARRAY['public.advance_payment_provider_event_state_guarded(uuid,text,text)',
                            'public.set_payment_provider_event_attributes(uuid,jsonb)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(fn)
                AND (p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=pg_catalog, public' = ANY (p.proconfig)))) THEN
      RAISE EXCEPTION 'payment_provider_event_state_writer: postcondition failed - % is SECURITY DEFINER or lacks the pinned search_path', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'payment_provider_event_state_writer: postcondition failed - a client role can EXECUTE %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'payment_provider_event_state_writer: postcondition failed - service_role cannot EXECUTE %', fn;
    END IF;
  END LOOP;
END
$post$;
