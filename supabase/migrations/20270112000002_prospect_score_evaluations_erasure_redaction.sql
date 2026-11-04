-- PI / person erasure — prospect_score_evaluations: one sanctioned redaction
-- path through the append-only trigger.
--
-- DEFECT. `prospect_score_evaluations_person_tenant_fk` is ON DELETE SET NULL
-- (whole-row form: (person_id, organization_id) — but organization_id is NOT
-- NULL, so in practice the action fails anyway) and
-- `trg_prospect_score_evaluations_immutable` refuses EVERY UPDATE. Deleting a
-- person with any score evaluation therefore aborts (23514 "append-only" from
-- the trigger, or 23502 on organization_id). Such a person is unerasable.
--
-- WHAT IS PERSONAL IN A ROW. person_id (the link), and the evaluator's
-- verbatim explanation: contributions / evidence / reasoning / facets /
-- context_gaps can quote facts about the person (role, seniority, employer
-- signals). The numeric scores, versions, timestamps, prospect/account/ICP ids
-- and input_digest are not personal on their own once the person is gone and
-- the prospect row is redacted by pi_erase_prospect_provenance.
--
-- THE PATH (narrow by construction):
--   * pi_erasure_redact_score_evaluations(org, person) — SECURITY DEFINER,
--     owner-only (NO client role, service_role included, can execute it),
--     called only by pi_person_erasure_finalize in the same transaction as the
--     person delete. It authorizes scope 'score_evaluations' for exactly this
--     (tenant, person) in the current transaction, redacts, and releases.
--   * the trigger admits an UPDATE only when ALL hold:
--       - that authorization is held for OLD.organization_id / OLD.person_id;
--       - OLD.person_id IS NOT NULL and NEW.person_id IS NULL;
--       - the five explanation columns equal the fixed redaction values;
--       - every other column is unchanged.
--     Anything else — any client, any role, service_role included, any other
--     column, any other person in the same transaction — is refused exactly as
--     before, with the same message and SQLSTATE.
--   * DELETE behaviour is unchanged (the trigger was, and stays, BEFORE UPDATE
--     only; prospect deletion still CASCADEs). Making DELETE append-only is a
--     separate owner question and is not decided here.
--
-- Redact, not delete: matches the provenance erasure policy (rows redacted in
-- place, the record that an evaluation happened survives without the person).
-- input_digest is kept (it is the idempotency key); it is a sha256 over ids
-- (including the erased person's random uuid), never over a personal value.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.prospect_score_evaluations') IS NULL THEN
    RAISE EXCEPTION 'PSE erasure preflight: apply 20261031000000_pi_score_evaluations first';
  END IF;
  IF to_regprocedure('public.pi_erasure_authorization_held(text, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'PSE erasure preflight: apply 20270112000000_pi_erasure_authorizations first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prospect_score_evaluations_immutable'
                    AND tgrelid = 'public.prospect_score_evaluations'::regclass) THEN
    RAISE EXCEPTION 'PSE erasure preflight: trg_prospect_score_evaluations_immutable is missing';
  END IF;
END
$preflight$;

-- The fixed redaction values, in one place (trigger and writer both use it).
CREATE OR REPLACE FUNCTION public.pi_score_evaluation_redaction_marker()
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$ SELECT '{"redacted": true, "reason": "person_erased"}'::jsonb $fn$;

CREATE OR REPLACE FUNCTION public.prospect_score_evaluations_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.person_id IS NOT NULL
     AND NEW.person_id IS NULL
     AND NEW.contributions = '[]'::jsonb
     AND NEW.evidence      = '[]'::jsonb
     AND NEW.reasoning     = '[]'::jsonb
     AND NEW.context_gaps  = '[]'::jsonb
     AND NEW.facets        = public.pi_score_evaluation_redaction_marker()
     AND (to_jsonb(NEW) - ARRAY['person_id', 'contributions', 'evidence', 'reasoning', 'facets', 'context_gaps'])
       = (to_jsonb(OLD) - ARRAY['person_id', 'contributions', 'evidence', 'reasoning', 'facets', 'context_gaps'])
     AND public.pi_erasure_authorization_held('score_evaluations', OLD.organization_id, OLD.person_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'prospect_score_evaluations is append-only: evaluation % may not be modified (record a new evaluation instead)', OLD.id
    USING ERRCODE = '23514';
END
$$;

REVOKE ALL ON FUNCTION public.prospect_score_evaluations_immutable() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.pi_erasure_redact_score_evaluations(p_organization_id uuid, p_person_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_organization_id IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'pi_erasure_redact_score_evaluations: tenant and person are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.unified_persons p
              WHERE p.id = p_person_id AND p.company_id IS DISTINCT FROM p_organization_id) THEN
    RAISE EXCEPTION 'pi_erasure_redact_score_evaluations: the person belongs to another tenant' USING ERRCODE = '42501';
  END IF;

  PERFORM public.pi_erasure_authorize('score_evaluations', p_organization_id, p_person_id);
  UPDATE public.prospect_score_evaluations e
     SET person_id     = NULL,
         contributions = '[]'::jsonb,
         evidence      = '[]'::jsonb,
         reasoning     = '[]'::jsonb,
         context_gaps  = '[]'::jsonb,
         facets        = public.pi_score_evaluation_redaction_marker()
   WHERE e.organization_id = p_organization_id
     AND e.person_id = p_person_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.pi_erasure_release('score_evaluations', p_organization_id, p_person_id);
  RETURN v_n;
END
$fn$;

-- Static form of the client-role revokes below, for check-migration-quality
-- (it reads top-level statements only). No privilege change: the DO block
-- already revokes the same roles; anon/authenticated exist on every target.
REVOKE ALL ON FUNCTION public.prospect_score_evaluations_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pi_erasure_redact_score_evaluations(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- The redaction marker is an IMMUTABLE constant with no data access, but the
-- Supabase schema default ACL would otherwise give anon/authenticated EXECUTE
-- on it (review L-2). The owner keeps EXECUTE; service_role is NOT granted:
-- every production caller (the trigger, the redaction, the verifier) is
-- SECURITY DEFINER and runs as the owner.
REVOKE ALL ON FUNCTION public.pi_score_evaluation_redaction_marker() FROM PUBLIC, anon, authenticated;

DO $revoke_fn$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION public.pi_erasure_redact_score_evaluations(uuid, uuid) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.pi_erasure_redact_score_evaluations(uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.prospect_score_evaluations_immutable() FROM %I', r);
    END IF;
  END LOOP;
END
$revoke_fn$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.prospect_score_evaluations'::regclass
                    AND t.tgname = 'trg_prospect_score_evaluations_immutable'
                    AND p.proname = 'prospect_score_evaluations_immutable'
                    AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'PSE erasure postcondition: the immutability trigger is missing or disabled';
  END IF;
  IF has_function_privilege('anon', 'public.pi_score_evaluation_redaction_marker()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pi_score_evaluation_redaction_marker()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PSE erasure postcondition: a client role can execute pi_score_evaluation_redaction_marker()';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     AND has_function_privilege('service_role', 'public.pi_erasure_redact_score_evaluations(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PSE erasure postcondition: service_role must not execute the redaction directly';
  END IF;
END
$verify$;

COMMIT;

-- Rollback: restore the 20261031000000 body of
-- public.prospect_score_evaluations_immutable() (unconditional RAISE, SECURITY
-- INVOKER), then DROP FUNCTION public.pi_erasure_redact_score_evaluations(uuid, uuid)
-- and public.pi_score_evaluation_redaction_marker(). Rows already redacted stay
-- redacted (the redaction is irreversible by design).
