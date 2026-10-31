-- PI / person erasure — COMPLETION VERIFICATION for the erasure ledger
-- (20270112000003). Adds no new erasure behaviour: it only records what the
-- erasure is about to touch and, after finalize, checks what is left.
--
-- WHY. `pi_person_erasure_finalize` marks a request `completed` when the person
-- row is gone. That proves the delete, not the absence of personal data: the
-- legacy-lead fields, the decision references, lead children, attribute
-- decision values and polymorphic references each follow their own (partly
-- owner-undecided) policy. The erasure API must never report COMPLETED on the
-- strength of the delete alone, so it verifies after finalize and reports what
-- remains, by check name and count, never by value.
--
-- 1. person_erasure_inventories — captured by the lease holder immediately
--    before finalize (personErasure.ts `beforeFinalize` hook), while the person
--    still exists: the ids of the person's legacy leads, canonical leads,
--    canonical users and attribute decisions. These links are severed by the
--    finalize transaction itself (FK SET NULL / redaction), so afterwards they
--    cannot be rediscovered. It holds the erased person's uuid (no FK, by
--    design: it is the key verification searches for) and NO personal value.
--    It is PURGED by the first clean verification; it is kept while residual
--    data remains, so an operator can re-verify after remediation. No client
--    role, and not service_role, can read it: only the two functions below.
-- 2. person_erasure_verifications — one row per verification run: outcome,
--    the checks with their category and count, the retention policies finalize
--    recorded. Codes and counts only; no person id, no value.
-- 3. pi_person_erasure_capture_inventory(org, request, lease) — lease holder
--    only, pending requests only, person taken from the LEDGER (never from the
--    caller). Re-capture on a resumed attempt merges (union) the id sets.
-- 4. pi_person_erasure_verify(org, request) — completed requests only.
--
-- CHECK CATEGORIES (the API's status mapping depends on them):
--   violation       — residual that the merged erasure contract removes
--                     (person row, any FK reference, unredacted canonical
--                     lead/user, legacy lead still linked/unstamped, a field the
--                     recorded hook policy says was redacted/nulled, missing
--                     provenance event). Never acceptable.
--   policy_retained — residual a recorded owner-selectable hook policy KEPT
--                     ('retain' in finalize_counts: legacy lead fields, SUBJ;
--                     outreach_decisions.person_id, ODEC).
--   known_gap       — residual in an area no merged erasure step covers
--                     (ER-GAP: lead children, attribute decision values,
--                     prospect score rows never linked to the person, audit and
--                     polymorphic references).
--   info            — pseudonymous keys that point at already-redacted rows
--                     (never blocks; reported for transparency).
-- `outcome` is 'clean' only when every non-info check counts zero. Whether a
-- policy_retained / known_gap residual may still be reported as COMPLETED is an
-- OWNER decision, implemented in the application (personErasureRequests.ts,
-- ACCEPTED_RESIDUAL_CHECKS, empty by default) — never here.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.person_erasure_requests') IS NULL
     OR to_regprocedure('public.pi_person_erasure_finalize(uuid, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'PEV preflight: apply 20270112000003 (erasure ledger) first';
  END IF;
  IF to_regprocedure('public.pi_score_evaluation_redaction_marker()') IS NULL THEN
    RAISE EXCEPTION 'PEV preflight: apply 20270112000002 (score evaluation redaction) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'leads' AND column_name = 'person_erased_at') THEN
    RAISE EXCEPTION 'PEV preflight: apply 20270112000001 (legacy leads erasure) first';
  END IF;
  IF to_regclass('public.canonical_attribute_decisions') IS NULL OR to_regclass('public.canonical_users') IS NULL
     OR to_regclass('public.canonical_leads') IS NULL OR to_regclass('public.prospect_provenance_erasures') IS NULL THEN
    RAISE EXCEPTION 'PEV preflight: canonical spine / provenance tables missing';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.person_erasure_inventories (
  request_id             uuid        PRIMARY KEY,
  organization_id        uuid        NOT NULL,
  -- The erased person's uuid. NO foreign key on purpose: it must outlive the
  -- delete, because it is what verification searches for. Purged on a clean
  -- verification.
  person_id              uuid        NOT NULL,
  legacy_lead_ids        uuid[]      NOT NULL DEFAULT '{}',
  canonical_lead_ids     uuid[]      NOT NULL DEFAULT '{}',
  canonical_user_ids     uuid[]      NOT NULL DEFAULT '{}',
  attribute_decision_ids uuid[]      NOT NULL DEFAULT '{}',
  captures               integer     NOT NULL DEFAULT 1,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pei_captures_positive CHECK (captures >= 1),
  CONSTRAINT pei_request_fk FOREIGN KEY (request_id)
    REFERENCES public.person_erasure_requests (id) ON DELETE CASCADE,
  CONSTRAINT pei_org_fk FOREIGN KEY (organization_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.person_erasure_verifications (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid        NOT NULL,
  organization_id  uuid        NOT NULL,
  verified_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome          text        NOT NULL,
  checks           jsonb       NOT NULL,
  policies         jsonb,
  inventory_purged boolean     NOT NULL DEFAULT false,
  CONSTRAINT pev_outcome_valid   CHECK (outcome IN ('clean', 'residual')),
  CONSTRAINT pev_checks_is_array CHECK (jsonb_typeof(checks) = 'array'),
  CONSTRAINT pev_request_fk FOREIGN KEY (request_id)
    REFERENCES public.person_erasure_requests (id) ON DELETE CASCADE,
  CONSTRAINT pev_org_fk FOREIGN KEY (organization_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_person_erasure_verifications_request
  ON public.person_erasure_verifications (request_id, verified_at DESC);

ALTER TABLE public.person_erasure_inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_erasure_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pev_service_role_read ON public.person_erasure_verifications;
CREATE POLICY pev_service_role_read ON public.person_erasure_verifications
  FOR SELECT USING (auth.role() = 'service_role');

REVOKE ALL ON TABLE public.person_erasure_inventories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.person_erasure_verifications FROM PUBLIC, anon, authenticated;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.person_erasure_inventories FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE public.person_erasure_verifications FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON TABLE public.person_erasure_verifications TO service_role;
  END IF;
END
$grants$;

-- ── capture (lease holder, before finalize) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_person_erasure_capture_inventory(
  p_organization_id uuid, p_request_id uuid, p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_req   public.person_erasure_requests;
  v_inv   public.person_erasure_inventories;
  v_leads uuid[];
  v_cl    uuid[];
  v_cu    uuid[];
  v_cad   uuid[];
BEGIN
  SELECT * INTO v_req FROM public.person_erasure_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person_erasure:request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'person_erasure:request_belongs_to_another_tenant' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'person_erasure:request_already_completed' USING ERRCODE = '55000';
  END IF;
  IF p_lease_token IS NULL OR v_req.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'person_erasure:lease_lost' USING ERRCODE = '55P03';
  END IF;
  IF v_req.person_id IS NULL THEN
    RAISE EXCEPTION 'person_erasure:person_vanished_outside_ledger' USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(array_agg(l.id), '{}') INTO v_leads FROM public.leads l
   WHERE l.company_id = p_organization_id AND l.unified_person_id = v_req.person_id;
  SELECT coalesce(array_agg(c.id), '{}') INTO v_cl FROM public.canonical_leads c
   WHERE c.company_id = p_organization_id AND c.unified_person_id = v_req.person_id;
  -- Same scope rule as pi_erase_prospect_provenance: users linked to the person
  -- or to one of the person's canonical leads.
  SELECT coalesce(array_agg(DISTINCT u.id), '{}') INTO v_cu FROM public.canonical_users u
   WHERE u.company_id = p_organization_id
     AND (u.unified_person_id = v_req.person_id
          OR u.id IN (SELECT c.user_id FROM public.canonical_leads c
                       WHERE c.company_id = p_organization_id AND c.id = ANY (v_cl)));
  SELECT coalesce(array_agg(d.id), '{}') INTO v_cad FROM public.canonical_attribute_decisions d
   WHERE d.organization_id = p_organization_id AND d.person_id = v_req.person_id;

  INSERT INTO public.person_erasure_inventories AS i
    (request_id, organization_id, person_id, legacy_lead_ids, canonical_lead_ids,
     canonical_user_ids, attribute_decision_ids)
  VALUES (p_request_id, p_organization_id, v_req.person_id, v_leads, v_cl, v_cu, v_cad)
  ON CONFLICT (request_id) DO UPDATE SET
    legacy_lead_ids        = ARRAY(SELECT DISTINCT x FROM unnest(i.legacy_lead_ids || EXCLUDED.legacy_lead_ids) x),
    canonical_lead_ids     = ARRAY(SELECT DISTINCT x FROM unnest(i.canonical_lead_ids || EXCLUDED.canonical_lead_ids) x),
    canonical_user_ids     = ARRAY(SELECT DISTINCT x FROM unnest(i.canonical_user_ids || EXCLUDED.canonical_user_ids) x),
    attribute_decision_ids = ARRAY(SELECT DISTINCT x FROM unnest(i.attribute_decision_ids || EXCLUDED.attribute_decision_ids) x),
    captures               = i.captures + 1,
    captured_at            = now()
  RETURNING * INTO v_inv;

  RETURN jsonb_build_object(
    'request_id', p_request_id, 'captures', v_inv.captures,
    'legacy_leads', cardinality(v_inv.legacy_lead_ids),
    'canonical_leads', cardinality(v_inv.canonical_lead_ids),
    'canonical_users', cardinality(v_inv.canonical_user_ids),
    'attribute_decisions', cardinality(v_inv.attribute_decision_ids));
END
$fn$;

-- ── verify (completed requests) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_person_erasure_verify(p_organization_id uuid, p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_req      public.person_erasure_requests;
  v_inv      public.person_erasure_inventories;
  v_last     public.person_erasure_verifications;
  v_checks   jsonb := '[]'::jsonb;
  v_policies jsonb;
  v_lead_pol text;
  v_dec_pol  text;
  v_p        uuid;
  v_n        bigint;
  v_fk       record;
  v_poly     record;
  v_org_col  text;
  v_dirty    boolean := false;
  v_id       uuid;
BEGIN
  SELECT * INTO v_req FROM public.person_erasure_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person_erasure:request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'person_erasure:request_belongs_to_another_tenant' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'completed' THEN
    RAISE EXCEPTION 'person_erasure:not_completed' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_inv FROM public.person_erasure_inventories i WHERE i.request_id = p_request_id;
  IF NOT FOUND THEN
    -- Purged by an earlier clean verification: answer with that record.
    SELECT * INTO v_last FROM public.person_erasure_verifications v
     WHERE v.request_id = p_request_id AND v.outcome = 'clean' AND v.inventory_purged
     ORDER BY v.verified_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('verification_id', v_last.id, 'outcome', v_last.outcome,
        'checks', v_last.checks, 'policies', v_last.policies, 'inventory_purged', true, 'repeated', true);
    END IF;
    RAISE EXCEPTION 'person_erasure:inventory_missing' USING ERRCODE = '55000';
  END IF;

  v_p        := v_inv.person_id;
  v_policies := coalesce(v_req.finalize_counts, '{}'::jsonb);
  v_lead_pol := coalesce(v_policies ->> 'legacy_lead_fields', 'unknown');
  v_dec_pol  := coalesce(v_policies ->> 'outreach_decision_person_ref', 'unknown');

  -- 1. direct identity row
  SELECT count(*) INTO v_n FROM public.unified_persons p WHERE p.id = v_p;
  v_checks := v_checks || jsonb_build_object('check', 'unified_persons.row', 'category', 'violation', 'count', v_n);

  -- 2. EVERY foreign key that references unified_persons, read from the catalog
  --    (so a table added later is checked without editing this function).
  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
      FROM pg_constraint c
      JOIN LATERAL generate_subscripts(c.confkey, 1) k(i) ON true
      JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[k.i] AND ra.attname = 'id'
      JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = c.conkey[k.i]
     WHERE c.contype = 'f' AND c.confrelid = 'public.unified_persons'::regclass
     ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tbl, v_fk.col) INTO v_n USING v_p;
    v_checks := v_checks || jsonb_build_object('check', 'fk:' || v_fk.tbl || '.' || v_fk.col,
                                               'category', 'violation', 'count', v_n);
  END LOOP;

  -- 3. outreach_decisions.person_id (no FK, append-only). ODEC decides.
  IF to_regclass('public.outreach_decisions') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.outreach_decisions d WHERE d.person_id = v_p;
    v_checks := v_checks || jsonb_build_object('check', 'outreach_decisions.person_id',
      'category', CASE WHEN v_dec_pol = 'retain' THEN 'policy_retained' ELSE 'violation' END, 'count', v_n);
  END IF;

  -- 4. legacy leads of the person (SUBJ decides the fields)
  SELECT count(*) INTO v_n FROM public.leads l
   WHERE l.id = ANY (v_inv.legacy_lead_ids) AND l.unified_person_id IS NOT NULL;
  v_checks := v_checks || jsonb_build_object('check', 'leads.person_link', 'category', 'violation', 'count', v_n);
  SELECT count(*) INTO v_n FROM public.leads l
   WHERE l.id = ANY (v_inv.legacy_lead_ids) AND l.person_erased_at IS NULL;
  v_checks := v_checks || jsonb_build_object('check', 'leads.not_stamped', 'category', 'violation', 'count', v_n);
  SELECT count(*) INTO v_n FROM public.leads l
   WHERE l.id = ANY (v_inv.legacy_lead_ids)
     AND (l.name IS DISTINCT FROM 'redacted' OR l.email IS DISTINCT FROM ('redacted:' || l.id::text)
          OR l.phone IS NOT NULL OR l.metadata IS DISTINCT FROM '{"redacted": true}'::jsonb
          OR l.attribution IS DISTINCT FROM '{}'::jsonb OR l.visitor_session_id IS NOT NULL);
  v_checks := v_checks || jsonb_build_object('check', 'leads.personal_fields',
    'category', CASE WHEN v_lead_pol = 'retain' THEN 'policy_retained' ELSE 'violation' END, 'count', v_n);

  -- 5. children of those leads (ER-GAP: no merged step covers them)
  SELECT count(*) INTO v_n FROM public.form_conversions f WHERE f.lead_id = ANY (v_inv.legacy_lead_ids);
  v_checks := v_checks || jsonb_build_object('check', 'form_conversions.rows', 'category', 'known_gap', 'count', v_n);
  SELECT count(*) INTO v_n FROM public.lead_attributions f WHERE f.lead_id = ANY (v_inv.legacy_lead_ids);
  v_checks := v_checks || jsonb_build_object('check', 'lead_attributions.rows', 'category', 'known_gap', 'count', v_n);
  SELECT count(*) INTO v_n FROM public.campaign_touchpoints f WHERE f.lead_id = ANY (v_inv.legacy_lead_ids);
  v_checks := v_checks || jsonb_build_object('check', 'campaign_touchpoints.rows', 'category', 'known_gap', 'count', v_n);

  -- 6. outreach_tasks.lead_id: the subject key (legacy lead or canonical lead id).
  --    Pseudonymous once its target is redacted; under SUBJ = retain it still
  --    resolves to a name.
  IF to_regclass('public.outreach_tasks') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.outreach_tasks t
     WHERE t.lead_id IN (SELECT x::text FROM unnest(v_inv.legacy_lead_ids) x);
    v_checks := v_checks || jsonb_build_object('check', 'outreach_tasks.lead_key_legacy',
      'category', CASE WHEN v_lead_pol = 'retain' THEN 'policy_retained' ELSE 'info' END, 'count', v_n);
    SELECT count(*) INTO v_n FROM public.outreach_tasks t
     WHERE t.lead_id IN (SELECT x::text FROM unnest(v_inv.canonical_lead_ids) x);
    v_checks := v_checks || jsonb_build_object('check', 'outreach_tasks.lead_key_prospect', 'category', 'info', 'count', v_n);
  END IF;

  -- 7. canonical leads / users of the person (closure A, 20270109000000)
  SELECT count(*) INTO v_n FROM public.canonical_leads c
   WHERE c.id = ANY (v_inv.canonical_lead_ids)
     AND (c.unified_person_id IS NOT NULL OR c.external_lead_key IS NOT NULL
          OR NOT (c.lead_metadata @> '{"redacted": true}'::jsonb));
  v_checks := v_checks || jsonb_build_object('check', 'canonical_leads.unredacted', 'category', 'violation', 'count', v_n);
  SELECT count(*) INTO v_n FROM public.canonical_users u
   WHERE u.id = ANY (v_inv.canonical_user_ids)
     AND (u.unified_person_id IS NOT NULL OR u.email IS NOT NULL OR u.full_name IS NOT NULL
          OR u.phone IS NOT NULL OR u.geo IS NOT NULL OR u.external_user_key IS NOT NULL
          OR NOT (u.user_metadata @> '{"redacted": true}'::jsonb));
  v_checks := v_checks || jsonb_build_object('check', 'canonical_users.unredacted', 'category', 'violation', 'count', v_n);

  -- 8. score evaluations of the person's prospects that were never linked to the
  --    person (the merged redaction path matches person_id only).
  SELECT count(*) INTO v_n FROM public.prospect_score_evaluations e
   WHERE e.organization_id = p_organization_id AND e.prospect_id = ANY (v_inv.canonical_lead_ids)
     AND e.facets IS DISTINCT FROM public.pi_score_evaluation_redaction_marker();
  v_checks := v_checks || jsonb_build_object('check', 'prospect_score_evaluations.unredacted_for_prospect',
    'category', 'known_gap', 'count', v_n);

  -- 9. attribute decision VALUES outlive the person (policy gap 1, ER-GAP)
  SELECT count(*) INTO v_n FROM public.canonical_attribute_decisions d
   WHERE d.id = ANY (v_inv.attribute_decision_ids);
  v_checks := v_checks || jsonb_build_object('check', 'canonical_attribute_decisions.value', 'category', 'known_gap', 'count', v_n);

  -- 10. the provenance erasure event must exist (ledger completeness)
  SELECT count(*) INTO v_n FROM public.prospect_provenance_erasures e
   WHERE e.id = v_req.provenance_erasure_id AND e.organization_id = p_organization_id;
  v_checks := v_checks || jsonb_build_object('check', 'prospect_provenance_erasures.event_missing',
    'category', 'violation', 'count', CASE WHEN v_n = 0 THEN 1 ELSE 0 END);

  -- 11. audit / event / polymorphic references that may quote the person's uuid
  --     as text (ER-GAP; checked only where the table and column exist).
  IF to_regclass('public.capability_audit_log') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.capability_audit_log a
     WHERE a.organization_id = p_organization_id AND a.resource_id = v_p::text;
    v_checks := v_checks || jsonb_build_object('check', 'capability_audit_log.resource_id', 'category', 'known_gap', 'count', v_n);
  END IF;
  FOR v_poly IN
    SELECT c.table_name::text AS tbl, c.column_name::text AS col
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name IN ('activity_feed', 'telemetry_events', 'execution_audit', 'copilot_responses',
                            'investigation_ai_summaries', 'review_sources')
       AND c.column_name IN ('entity_id', 'subject_id', 'subject_ref')
     ORDER BY 1, 2
  LOOP
    v_org_col := (SELECT c2.column_name::text FROM information_schema.columns c2
                   WHERE c2.table_schema = 'public' AND c2.table_name = v_poly.tbl
                     AND c2.column_name IN ('organization_id', 'company_id')
                   ORDER BY c2.column_name LIMIT 1);
    IF v_org_col IS NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text = $1', v_poly.tbl, v_poly.col)
        INTO v_n USING v_p::text;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text = $2 AND %I::text = $1',
                     v_poly.tbl, v_org_col, v_poly.col)
        INTO v_n USING v_p::text, p_organization_id::text;
    END IF;
    v_checks := v_checks || jsonb_build_object('check', 'polymorphic:' || v_poly.tbl || '.' || v_poly.col,
                                               'category', 'known_gap', 'count', v_n);
  END LOOP;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) e
                  WHERE e ->> 'category' <> 'info' AND (e ->> 'count')::bigint > 0) INTO v_dirty;

  INSERT INTO public.person_erasure_verifications
    (request_id, organization_id, outcome, checks, policies, inventory_purged)
  VALUES (p_request_id, p_organization_id, CASE WHEN v_dirty THEN 'residual' ELSE 'clean' END,
          v_checks, v_policies, NOT v_dirty)
  RETURNING id INTO v_id;

  IF NOT v_dirty THEN
    -- Nothing left to look for: the last copy of the erased person's uuid goes.
    DELETE FROM public.person_erasure_inventories i WHERE i.request_id = p_request_id;
  END IF;

  RETURN jsonb_build_object('verification_id', v_id, 'outcome', CASE WHEN v_dirty THEN 'residual' ELSE 'clean' END,
    'checks', v_checks, 'policies', v_policies, 'inventory_purged', NOT v_dirty, 'repeated', false);
END
$fn$;

-- Static form of the client-role revokes, for check-migration-quality (it reads
-- top-level statements only). The DO block repeats them for every role present.
REVOKE ALL ON FUNCTION public.pi_person_erasure_capture_inventory(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pi_person_erasure_verify(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $grants_fn$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.pi_person_erasure_capture_inventory(uuid, uuid, uuid)',
    'public.pi_person_erasure_verify(uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.pi_person_erasure_capture_inventory(uuid, uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.pi_person_erasure_verify(uuid, uuid) TO service_role;
  END IF;
END
$grants_fn$;

COMMENT ON TABLE public.person_erasure_inventories IS
  'Erasure completion-verification inventory: ids severed by finalize, captured by the lease holder '
  'before finalize. Holds the erased person uuid until the first clean verification purges it. '
  'No client or service_role access; written and read only by pi_person_erasure_capture_inventory / _verify.';
COMMENT ON TABLE public.person_erasure_verifications IS
  'One row per erasure completion verification: outcome and check counts by name and category. '
  'No person id, no personal value.';

DO $verify$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND (
         has_table_privilege(r, 'public.person_erasure_inventories', 'SELECT')
      OR has_table_privilege(r, 'public.person_erasure_verifications', 'SELECT')
      OR has_function_privilege(r, 'public.pi_person_erasure_capture_inventory(uuid, uuid, uuid)', 'EXECUTE')
      OR has_function_privilege(r, 'public.pi_person_erasure_verify(uuid, uuid)', 'EXECUTE')) THEN
      RAISE EXCEPTION 'PEV postcondition: client role % holds a privilege', r;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND (
       has_table_privilege('service_role', 'public.person_erasure_inventories', 'SELECT')
    OR has_table_privilege('service_role', 'public.person_erasure_inventories', 'INSERT')
    OR has_table_privilege('service_role', 'public.person_erasure_verifications', 'INSERT')
    OR has_table_privilege('service_role', 'public.person_erasure_verifications', 'UPDATE')
    OR has_table_privilege('service_role', 'public.person_erasure_verifications', 'DELETE')) THEN
    RAISE EXCEPTION 'PEV postcondition: service_role may only SELECT verifications and call the two functions';
  END IF;
END
$verify$;

COMMIT;
