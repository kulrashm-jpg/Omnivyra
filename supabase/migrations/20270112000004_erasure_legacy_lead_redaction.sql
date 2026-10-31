-- OWNER-SELECTABLE — subject_id decision, option S ("sever the target").
-- This commit is DROPPABLE: without it, pi_person_erasure_legacy_lead_policy
-- stays the 20270112000003 default (R = retain) and nothing else changes.
-- Requires the privacy owner's signature on SUBJECT-ID-DECISION.md (option S).
--
-- WHY. For subject_kind = 'lead', the subject_id held by execution_instances /
-- execution_tasks / outreach_bridge_handoffs / outreach_tasks.lead_id is the
-- legacy `leads.id`. After 20270112000001 that lead survives the person's
-- erasure with its person link detached — but still holding name, email,
-- phone, metadata and attribution. A surviving key that resolves to a name and
-- an address is direct re-identification, whatever the key itself looks like.
-- Option S removes the personal fields from the TARGET row, so every copy of
-- the key (in four tables, three of them immutable) points at a row that no
-- longer identifies anybody — without touching any of those immutable rows.
--
-- WHAT IT REDACTS (only leads with person_erased_at set, of the erased person,
-- in the same transaction as the person delete):
--   name        -> 'redacted'                  (NOT NULL)
--   email       -> 'redacted:' || id           (NOT NULL; derived from the row's
--                                               random uuid, never from the value)
--   phone       -> NULL
--   metadata    -> {"redacted": true}
--   attribution -> {}
--   visitor_session_id -> NULL                 (a link to a session row that can
--                                               carry IP / user agent)
-- Kept: id, company_id, source, integration_id, form_id, website_id, is_test,
-- consent_state, created_at, created_by, person_erased_at — business facts with
-- no personal value of their own.
-- NOT covered (recorded residuals, see ERASURE-AND-PRIVACY.md): children keyed by
-- lead_id that copy form input or touchpoint text (form_conversions,
-- lead_attributions, campaign_touchpoints) — a data-proof job per table.
--
-- Irreversible by design. Rollback restores the default hook only; redacted rows
-- stay redacted.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.pi_person_erasure_legacy_lead_policy(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'S preflight: apply 20270112000003 (erasure ledger) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'leads' AND column_name = 'person_erased_at') THEN
    RAISE EXCEPTION 'S preflight: apply 20270112000001 (legacy leads erasure) first';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.pi_person_erasure_legacy_lead_policy(p_organization_id uuid, p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  -- S (sever the target): runs after step 6b stamped person_erased_at and
  -- before the delete nulls the link, so the person's leads are still exactly
  -- identifiable here.
  UPDATE public.leads l
     SET name = 'redacted',
         email = 'redacted:' || l.id::text,
         phone = NULL,
         metadata = '{"redacted": true}'::jsonb,
         attribution = '{}'::jsonb,
         visitor_session_id = NULL
   WHERE l.company_id = p_organization_id
     AND l.unified_person_id = p_person_id
     AND l.person_erased_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('legacy_lead_fields', 'redact', 'legacy_leads_redacted', v_n);
END
$fn$;

DO $revoke_fn$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION public.pi_person_erasure_legacy_lead_policy(uuid, uuid) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.pi_person_erasure_legacy_lead_policy(uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
END
$revoke_fn$;

COMMIT;

-- Rollback (returns to R for FUTURE erasures; already-redacted rows stay redacted):
--   CREATE OR REPLACE FUNCTION public.pi_person_erasure_legacy_lead_policy(uuid, uuid) with the
--   20270112000003 body (RETURN jsonb_build_object('legacy_lead_fields', 'retain')), same grants.
