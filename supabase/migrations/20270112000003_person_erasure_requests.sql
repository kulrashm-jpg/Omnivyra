-- PI / person erasure — resumable, tenant-safe erasure-request LEDGER, and
-- steps 6+7 in ONE transaction.
--
-- Supersedes the unreviewed proposal 20270110000001 (A6-10 workstream H; that
-- version number is taken by other branches). Differences from that proposal:
--   * no dependency on the A6-10 bridge migration (outreach_bridge_handoffs only
--     exists on the candidate stack). If a bridged handoff still blocks the
--     delete, finalize names the blocker and rolls everything back;
--   * a LEASE: two concurrent erasePerson() calls for the same person cannot run
--     steps 3-5 in parallel; the second gets person_erasure:in_progress (55P03)
--     until the first finishes, fails (mark 'failed' releases the lease) or its
--     lease expires (crash);
--   * finalize also detaches legacy leads (20270112000001) and redacts score
--     evaluations (20270112000002) in the same transaction as the delete, and
--     runs two owner-selectable retention hooks (default: retain = no change);
--   * finalize locks the PERSON before the request (same order as open), so
--     open/finalize cannot deadlock;
--   * pi_person_erasure_inconsistencies(org) reports partial states.
--
-- STEP NUMBERING = personErasure.ts: 1 read contact points, 2 read governance,
--   3 carry instructions forward (re-anchor), 4 revoke originals, 5 clear the
--   employer leg on the person's own assertions, 6 provenance erasure (+6b leads
--   detach, 6c score-evaluation redaction, 6d/6e retention hooks), 7 delete.
--   Steps 1-2 are reads. Steps 3-5 are idempotent application writes committed
--   one by one; a retry ALWAYS re-runs them (a person-anchored record written
--   between two attempts must also be carried forward); their markers are proof
--   of progress. Finalize REFUSES unless 3-5 are marked AND no live
--   person-anchored governance record remains.
--
-- EVIDENCE KEPT (minimal, non-identifying): tenant, request id, requester label,
-- the caller's reason, attempt count, step timestamps, counts, the provenance
-- erasure event id, the retention policy each hook applied, the last error CODE
-- (an SQLSTATE or a fixed label, never a message). A completed request holds NO
-- person id (CHECK). The caller must not put personal data into `reason`;
-- J1 ER-4: the free text is NOT copied into prospect_provenance_erasures any
-- more - that record receives the fixed text 'person erased: erasure request
-- <request id>' (the id resolves to this ledger row, where the bounded reason
-- stays under owner-only access). `requested_by` is a ROLE/OPERATOR LABEL
-- (e.g. 'dsar-operator', 'privacy-team'), never a personal identifier; it is
-- still passed to the provenance event as its actor label.
--
-- J1 A6-1 integration: finalize also authorizes scope 'bridge_handoffs' for the
-- person around the DELETE, so the A6-10 handoff guard (20270113000000, landing
-- after this) can tell an erasure from any other delete of the person (e.g.
-- merge_unified_persons). Without A6-10 the scope is unused and harmless.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.unified_persons') IS NULL OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PER preflight: unified_persons / companies missing';
  END IF;
  IF to_regclass('public.contact_governance_records') IS NULL THEN
    RAISE EXCEPTION 'PER preflight: contact_governance_records missing';
  END IF;
  IF to_regprocedure('public.pi_erase_prospect_provenance(uuid, uuid, uuid[], text, text)') IS NULL THEN
    RAISE EXCEPTION 'PER preflight: apply 20270109000000 (pi_erase_prospect_provenance) first';
  END IF;
  IF to_regprocedure('public.pi_erasure_detach_legacy_leads(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'PER preflight: apply 20270112000001 (legacy leads erasure) first';
  END IF;
  IF to_regprocedure('public.pi_erasure_redact_score_evaluations(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'PER preflight: apply 20270112000002 (score evaluation redaction) first';
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'PER preflight: auth.role() is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid = 'public.unified_persons'::regclass AND i.indisunique
                    AND i.indpred IS NULL
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(i.indkey) k JOIN pg_attribute a
                             ON a.attrelid = i.indrelid AND a.attnum = k) = ARRAY['company_id', 'id']) THEN
    RAISE EXCEPTION 'PER preflight: unified_persons needs a UNIQUE (id, company_id) key for a tenant-safe FK';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.person_erasure_requests (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  -- The person while the request is OPEN. Nulled by the FK in the delete's own
  -- statement; a completed request never holds it (CHECK below).
  person_id                 uuid,
  reason                    text        NOT NULL,
  requested_by              text        NOT NULL,
  status                    text        NOT NULL DEFAULT 'pending',
  attempts                  integer     NOT NULL DEFAULT 1,
  lease_token               uuid,
  lease_expires_at          timestamptz,
  governance_reanchored_at  timestamptz,   -- step 3
  governance_revoked_at     timestamptz,   -- step 4
  evidence_links_cleared_at timestamptz,   -- step 5
  provenance_erased_at      timestamptz,   -- step 6 (finalize)
  person_deleted_at         timestamptz,   -- step 7 (finalize, same transaction as 6)
  provenance_erasure_id     uuid,          -- the prospect_provenance_erasures event of step 6
  reanchored_count          integer     NOT NULL DEFAULT 0,
  revoked_count             integer     NOT NULL DEFAULT 0,
  finalize_counts           jsonb,         -- 6b/6c counts, 6d/6e policies applied
  last_error_code           text,
  last_attempt_at           timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  completed_at              timestamptz,

  CONSTRAINT per_reason_present        CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT per_requested_by_present  CHECK (length(btrim(requested_by)) BETWEEN 1 AND 200),
  CONSTRAINT per_status_valid          CHECK (status IN ('pending', 'completed')),
  CONSTRAINT per_attempts_positive     CHECK (attempts >= 1),
  CONSTRAINT per_counts_nonnegative    CHECK (reanchored_count >= 0 AND revoked_count >= 0),
  CONSTRAINT per_error_code_shape      CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  CONSTRAINT per_lease_coherent        CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT per_completed_coherent    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT per_completed_no_person   CHECK (status <> 'completed' OR person_id IS NULL),
  CONSTRAINT per_completed_no_lease    CHECK (status <> 'completed' OR lease_token IS NULL),
  CONSTRAINT per_completed_all_steps   CHECK (status <> 'completed' OR (
        governance_reanchored_at IS NOT NULL AND governance_revoked_at IS NOT NULL
    AND evidence_links_cleared_at IS NOT NULL AND provenance_erased_at IS NOT NULL
    AND person_deleted_at IS NOT NULL AND provenance_erasure_id IS NOT NULL)),

  CONSTRAINT per_org_fk FOREIGN KEY (organization_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT per_person_tenant_fk FOREIGN KEY (person_id, organization_id)
    REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_person_erasure_requests_open
  ON public.person_erasure_requests (organization_id, person_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_person_erasure_requests_pending
  ON public.person_erasure_requests (organization_id, last_attempt_at)
  WHERE status = 'pending';

ALTER TABLE public.person_erasure_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS per_service_role_read ON public.person_erasure_requests;
CREATE POLICY per_service_role_read ON public.person_erasure_requests
  FOR SELECT USING (auth.role() = 'service_role');
REVOKE ALL ON TABLE public.person_erasure_requests FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.person_erasure_requests FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON TABLE public.person_erasure_requests TO service_role;
  END IF;
END
$grants$;

-- ── owner-selectable retention hooks (DEFAULT = retain, i.e. no change) ─────
-- Replaced ONLY by an owner-approved migration (see SUBJECT-ID-DECISION.md and
-- D-2-A6-10-decision-v3.md). Owner-only; called inside finalize.
CREATE OR REPLACE FUNCTION public.pi_person_erasure_legacy_lead_policy(p_organization_id uuid, p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- R (retain): the legacy lead rows keep their own fields; only the person
  -- link is detached (step 6b). Pending the owner's subject_id decision.
  RETURN jsonb_build_object('legacy_lead_fields', 'retain');
END
$fn$;

CREATE OR REPLACE FUNCTION public.pi_person_erasure_decision_ref_policy(p_organization_id uuid, p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- R (retain): outreach_decisions.person_id keeps naming the erased person's
  -- uuid, as A3 (20261011000000 section 4) designed. Pending the owner decision.
  RETURN jsonb_build_object('outreach_decision_person_ref', 'retain');
END
$fn$;

-- ── open / resume ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_person_erasure_open(
  p_organization_id uuid, p_person_id uuid, p_reason text, p_requested_by text,
  p_lease_seconds integer DEFAULT 600
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_req   public.person_erasure_requests;
  v_owner uuid;
  v_lease interval;
BEGIN
  IF p_organization_id IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'person_erasure:tenant_and_person_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR p_requested_by IS NULL OR btrim(p_requested_by) = '' THEN
    RAISE EXCEPTION 'person_erasure:reason_and_requester_required' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'person_erasure:lease_seconds_out_of_range' USING ERRCODE = '22023';
  END IF;
  v_lease := make_interval(secs => p_lease_seconds);

  -- Lock the PERSON first (finalize takes the same order): serialises opens.
  SELECT p.company_id INTO v_owner FROM public.unified_persons p WHERE p.id = p_person_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person_erasure:person_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'person_erasure:person_belongs_to_another_tenant' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.person_erasure_requests r
   WHERE r.organization_id = p_organization_id AND r.person_id = p_person_id AND r.status = 'pending'
     FOR UPDATE;
  IF FOUND THEN
    IF v_req.lease_token IS NOT NULL AND v_req.lease_expires_at > clock_timestamp() THEN
      RAISE EXCEPTION 'person_erasure:in_progress' USING ERRCODE = '55P03';
    END IF;
    UPDATE public.person_erasure_requests r
       SET attempts = r.attempts + 1, last_attempt_at = now(),
           lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + v_lease
     WHERE r.id = v_req.id
    RETURNING * INTO v_req;
    RETURN jsonb_build_object('request_id', v_req.id, 'resumed', true, 'attempts', v_req.attempts,
      'lease_token', v_req.lease_token,
      'steps', jsonb_build_object('3', v_req.governance_reanchored_at, '4', v_req.governance_revoked_at,
                                  '5', v_req.evidence_links_cleared_at));
  END IF;

  INSERT INTO public.person_erasure_requests
    (organization_id, person_id, reason, requested_by, lease_token, lease_expires_at)
  VALUES (p_organization_id, p_person_id, btrim(p_reason), btrim(p_requested_by),
          gen_random_uuid(), clock_timestamp() + v_lease)
  RETURNING * INTO v_req;
  RETURN jsonb_build_object('request_id', v_req.id, 'resumed', false, 'attempts', v_req.attempts,
    'lease_token', v_req.lease_token,
    'steps', jsonb_build_object('3', NULL, '4', NULL, '5', NULL));
END
$fn$;

-- ── step markers / failure note (lease holder only) ───────────────────────
CREATE OR REPLACE FUNCTION public.pi_person_erasure_mark(
  p_organization_id uuid, p_request_id uuid, p_lease_token uuid, p_step text,
  p_count integer DEFAULT NULL, p_error_code text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_req public.person_erasure_requests;
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
  IF p_count IS NOT NULL AND p_count < 0 THEN
    RAISE EXCEPTION 'person_erasure:negative_count' USING ERRCODE = '22023';
  END IF;

  CASE p_step
    WHEN 'governance_reanchored' THEN
      UPDATE public.person_erasure_requests SET governance_reanchored_at = now(),
             reanchored_count = reanchored_count + coalesce(p_count, 0) WHERE id = p_request_id;
    WHEN 'governance_revoked' THEN
      UPDATE public.person_erasure_requests SET governance_revoked_at = now(),
             revoked_count = revoked_count + coalesce(p_count, 0) WHERE id = p_request_id;
    WHEN 'evidence_links_cleared' THEN
      UPDATE public.person_erasure_requests SET evidence_links_cleared_at = now() WHERE id = p_request_id;
    WHEN 'failed' THEN
      -- Records a CODE only, and releases the lease so a retry can resume at once.
      UPDATE public.person_erasure_requests
         SET last_error_code = CASE WHEN p_error_code ~ '^[A-Za-z0-9_.:-]{1,80}$' THEN p_error_code ELSE 'unclassified' END,
             lease_token = NULL, lease_expires_at = NULL
       WHERE id = p_request_id;
    ELSE
      RAISE EXCEPTION 'person_erasure:unknown_step' USING ERRCODE = '22023';
  END CASE;
END
$fn$;

-- ── steps 6 + 7, one transaction ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_person_erasure_finalize(
  p_organization_id uuid, p_request_id uuid, p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_req     public.person_erasure_requests;
  v_person  uuid;
  v_prov    jsonb;
  v_counts  jsonb;
  v_leads   integer;
  v_scores  integer;
  v_n       integer;
  v_con     text;
  v_state   text;
  v_tbl     text;
  v_col     text;
  v_live    integer;
BEGIN
  -- Read the person without locking, lock the PERSON, then the request (same
  -- order as open), then re-read.
  SELECT r.person_id INTO v_person FROM public.person_erasure_requests r WHERE r.id = p_request_id;
  IF v_person IS NOT NULL THEN
    PERFORM 1 FROM public.unified_persons p WHERE p.id = v_person FOR UPDATE;
  END IF;
  SELECT * INTO v_req FROM public.person_erasure_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person_erasure:request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'person_erasure:request_belongs_to_another_tenant' USING ERRCODE = '42501';
  END IF;
  IF v_req.status = 'completed' THEN
    RETURN jsonb_build_object('request_id', v_req.id, 'deleted', false, 'already_completed', true,
                              'provenance_erasure_id', v_req.provenance_erasure_id);
  END IF;
  IF p_lease_token IS NULL OR v_req.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'person_erasure:lease_lost' USING ERRCODE = '55P03';
  END IF;
  IF v_req.person_id IS NULL THEN
    -- The person disappeared OUTSIDE this ledger. Steps 6/7 cannot be proven.
    RAISE EXCEPTION 'person_erasure:person_vanished_outside_ledger' USING ERRCODE = '55000';
  END IF;
  IF v_req.governance_reanchored_at IS NULL OR v_req.governance_revoked_at IS NULL
     OR v_req.evidence_links_cleared_at IS NULL THEN
    RAISE EXCEPTION 'person_erasure:steps_3_to_5_incomplete' USING ERRCODE = '55000';
  END IF;
  v_person := v_req.person_id;

  SELECT count(*) INTO v_live FROM public.contact_governance_records g
   WHERE g.organization_id = p_organization_id AND g.person_id = v_person AND g.revoked_at IS NULL;
  IF v_live > 0 THEN
    RAISE EXCEPTION 'person_erasure:live_person_governance_remains' USING ERRCODE = '55000';
  END IF;

  -- step 6
  v_prov := public.pi_erase_prospect_provenance(
    p_organization_id, v_person, ARRAY[]::uuid[],
    'person erased: erasure request ' || v_req.id::text, v_req.requested_by);   -- J1 ER-4: no free text
  IF v_prov IS NULL OR (v_prov ->> 'erasure_id') IS NULL THEN
    RAISE EXCEPTION 'person_erasure:provenance_returned_no_event' USING ERRCODE = 'P0001';
  END IF;
  -- 6b / 6c — sanctioned writes for the two tables that otherwise block the delete
  v_leads  := public.pi_erasure_detach_legacy_leads(p_organization_id, v_person);
  v_scores := public.pi_erasure_redact_score_evaluations(p_organization_id, v_person);
  v_counts := jsonb_build_object('legacy_leads_detached', v_leads, 'score_evaluations_redacted', v_scores)
           || public.pi_person_erasure_legacy_lead_policy(p_organization_id, v_person)   -- 6d
           || public.pi_person_erasure_decision_ref_policy(p_organization_id, v_person); -- 6e

  -- step 7, SAME transaction. Any failure re-raises and rolls back 6..6e.
  -- 'bridge_handoffs': the erasure signal the A6-10 handoff guard requires to
  -- admit its ON DELETE SET NULL (J1 A6-1); released right after the delete.
  PERFORM public.pi_erasure_authorize('bridge_handoffs', p_organization_id, v_person);
  BEGIN
    DELETE FROM public.unified_persons p WHERE p.company_id = p_organization_id AND p.id = v_person;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME, v_state = RETURNED_SQLSTATE,
                            v_tbl = TABLE_NAME, v_col = COLUMN_NAME;
    v_con := coalesce(nullif(v_con, ''),
                      nullif(concat_ws('.', nullif(v_tbl, ''), nullif(v_col, '')), ''), 'unknown');
    -- Name only: the original message can quote row values, so it is not echoed.
    RAISE EXCEPTION 'person_erasure:delete_blocked_by %', v_con
      USING ERRCODE = v_state, CONSTRAINT = v_con;
  END;
  PERFORM public.pi_erasure_release('bridge_handoffs', p_organization_id, v_person);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'person_erasure:person_not_deleted' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.person_erasure_requests
     SET provenance_erased_at = now(), person_deleted_at = now(),
         provenance_erasure_id = (v_prov ->> 'erasure_id')::uuid,
         finalize_counts = v_counts,
         status = 'completed', completed_at = now(), last_error_code = NULL,
         lease_token = NULL, lease_expires_at = NULL
   WHERE id = p_request_id;

  RETURN jsonb_build_object('request_id', v_req.id, 'deleted', true, 'already_completed', false,
                            'provenance_erasure_id', v_prov ->> 'erasure_id', 'provenance', v_prov,
                            'finalize_counts', v_counts);
END
$fn$;

-- ── partial-state detector (read-only) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_person_erasure_inconsistencies(p_organization_id uuid)
RETURNS TABLE (request_id uuid, problem text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  -- a pending request whose person was deleted by something other than finalize
  SELECT r.id, 'person_vanished_outside_ledger'::text
    FROM public.person_erasure_requests r
   WHERE r.organization_id = p_organization_id AND r.status = 'pending' AND r.person_id IS NULL
  UNION ALL
  -- a pending request whose lease expired without a recorded failure (a crash)
  SELECT r.id, 'lease_expired_without_outcome'
    FROM public.person_erasure_requests r
   WHERE r.organization_id = p_organization_id AND r.status = 'pending'
     AND r.lease_expires_at IS NOT NULL AND r.lease_expires_at < clock_timestamp()
  UNION ALL
  -- steps 3-4 marked but a live person-anchored record exists again
  SELECT r.id, 'live_person_governance_after_revocation'
    FROM public.person_erasure_requests r
   WHERE r.organization_id = p_organization_id AND r.status = 'pending'
     AND r.governance_revoked_at IS NOT NULL AND r.person_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.contact_governance_records g
                  WHERE g.organization_id = r.organization_id AND g.person_id = r.person_id
                    AND g.revoked_at IS NULL)
  UNION ALL
  -- a completed request whose provenance event is missing
  SELECT r.id, 'completed_without_provenance_event'
    FROM public.person_erasure_requests r
   WHERE r.organization_id = p_organization_id AND r.status = 'completed'
     AND NOT EXISTS (SELECT 1 FROM public.prospect_provenance_erasures e
                      WHERE e.id = r.provenance_erasure_id AND e.organization_id = r.organization_id)
  UNION ALL
  -- a lead stamped erased whose person still exists (cannot arise through finalize).
  -- J1 ER-4(b): the cap applies to THIS arm only, not to the whole UNION.
  (SELECT NULL::uuid, 'legacy_lead_stamped_but_person_present'
     FROM public.leads l
    WHERE l.company_id = p_organization_id AND l.person_erased_at IS NOT NULL
      AND l.unified_person_id IS NOT NULL
    LIMIT 1000);
$fn$;

DO $grants_fn$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.pi_person_erasure_open(uuid, uuid, text, text, integer)',
    'public.pi_person_erasure_mark(uuid, uuid, uuid, text, integer, text)',
    'public.pi_person_erasure_finalize(uuid, uuid, uuid)',
    'public.pi_person_erasure_inconsistencies(uuid)',
    'public.pi_person_erasure_legacy_lead_policy(uuid, uuid)',
    'public.pi_person_erasure_decision_ref_policy(uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.pi_person_erasure_open(uuid, uuid, text, text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.pi_person_erasure_mark(uuid, uuid, uuid, text, integer, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.pi_person_erasure_finalize(uuid, uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.pi_person_erasure_inconsistencies(uuid) TO service_role;
  END IF;
END
$grants_fn$;

COMMENT ON TABLE public.person_erasure_requests IS
  'Person erasure request ledger. One open request per person, leased to one runner; retries '
  'resume it. Steps 3-5 are marked by the application; steps 6+7 run in one transaction '
  '(pi_person_erasure_finalize). A completed request holds no person id.';

DO $verify$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'per_person_tenant_fk'
                    AND confdeltype = 'n' AND conrelid = 'public.person_erasure_requests'::regclass) THEN
    RAISE EXCEPTION 'PER postcondition: per_person_tenant_fk must be ON DELETE SET NULL';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND (
         has_table_privilege(r, 'public.person_erasure_requests', 'SELECT')
      OR has_function_privilege(r, 'public.pi_person_erasure_finalize(uuid, uuid, uuid)', 'EXECUTE')
      OR has_function_privilege(r, 'public.pi_person_erasure_open(uuid, uuid, text, text, integer)', 'EXECUTE')
      OR has_function_privilege(r, 'public.pi_person_erasure_mark(uuid, uuid, uuid, text, integer, text)', 'EXECUTE')) THEN
      RAISE EXCEPTION 'PER postcondition: client role % holds a privilege', r;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND (
       has_table_privilege('service_role', 'public.person_erasure_requests', 'INSERT')
    OR has_table_privilege('service_role', 'public.person_erasure_requests', 'UPDATE')
    OR has_table_privilege('service_role', 'public.person_erasure_requests', 'DELETE')
    OR has_function_privilege('service_role', 'public.pi_person_erasure_legacy_lead_policy(uuid, uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.pi_person_erasure_decision_ref_policy(uuid, uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'PER postcondition: service_role may only SELECT the ledger and call open/mark/finalize';
  END IF;
END
$verify$;

COMMIT;

-- Rollback: DROP FUNCTION pi_person_erasure_inconsistencies(uuid), _finalize(uuid,uuid,uuid),
-- _mark(uuid,uuid,uuid,text,integer,text), _open(uuid,uuid,text,text,integer),
-- pi_person_erasure_decision_ref_policy(uuid,uuid), pi_person_erasure_legacy_lead_policy(uuid,uuid);
-- DROP TABLE person_erasure_requests. personErasure.ts must be reverted in the same change
-- (it fails closed without these functions).
