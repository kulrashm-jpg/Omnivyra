-- Orchestration (G-11) — a company admin's MANUAL closure of a prospect to NEW journeys.
--
-- WHY. Owner ruling (2026-11-07), verbatim: "new journey gets closed while prospect is closed and
-- once it is opened by admin it will be open for new journeys. only copany admin can close or
-- reopen the prospect". Asked whether an admin may also close without an opt-out: "Also a manual
-- close". PI ruled this lives on the Orchestration side (option A): PI's terminal
-- closed_disqualified is NOT used or made reversible (its terminality underpins the Prompt 5
-- key-change certification), so P-1's terminal closure for an opt-out is withdrawn.
--
-- TWO GATES at enrolment (enrollment.ts), both reported as `contact_closed_by_admin`:
--   * review-derived: an opt-out review that touches the prospect is pending, or decided
--     keep_closed — read straight from contact_opt_out_reviews, no second write;
--   * manual: an ACTIVE row here (reopened_at IS NULL). This table.
-- Only NEW journeys are gated; runs already active are not touched by a manual close.
--
-- WHAT A ROW MEANS. "An admin closed this prospect to new journeys at closed_at, for this reason"
-- and, once reopened, "an admin reopened it at reopened_at, for this reason". History is
-- append-only: a reopen fills the reopened_* fields once; a later close is a NEW row. One ACTIVE
-- closure per (organization, prospect), by a unique partial index. No DELETE is granted.
--
-- ERASURE. prospect_id is a canonical_leads id, not the person's key: an erased person's
-- unified_persons id never appears here. canonical_leads rows SURVIVE erasure (PL-DEC-003, rows
-- kept, personal fields redacted), so the closure stays attached to the prospect and keeps it
-- closed after an erasure. ON DELETE CASCADE (the prospect_lifecycle precedent): if a prospect row
-- is ever deleted, a closure of a prospect that no longer exists protects nothing. closed_by and
-- reopened_by are OPERATOR ids (the admin acting), not the data subject. PI ruled a SPLIT: the
-- row and every enforcing column are KEEP (the closure must outlive erasure, and it holds only a
-- prospect identifier); close_reason and reopen_reason are MAPPED — an operator's free text may
-- hold personal data and nothing depends on it — and are redacted at erasure to
-- '[redacted: subject erased]' by public.g11_redact_enrolment_closure_reasons, which PI's erasure
-- calls with the erased person's prospect ids. The placeholder, not NULL or empty: close_reason is
-- NOT NULL (1–500), and reopen_reason is all-or-none with the reopen; a never-reopened row keeps
-- reopen_reason NULL. The reasons are never copied into the audit record.
--
-- Tenant table: RLS on, EXPLICIT REVOKE from PUBLIC/anon/authenticated and an explicit grant to
-- service_role. Forward only; rollback in rollbacks/contact_enrolment_closures_rollback.sql.

CREATE TABLE IF NOT EXISTS public.contact_enrolment_closures (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  prospect_id      uuid        NOT NULL,
  closed_by        uuid        NOT NULL,
  closed_at        timestamptz NOT NULL DEFAULT now(),
  close_reason     text        NOT NULL,
  reopened_by      uuid,
  reopened_at      timestamptz,
  reopen_reason    text,

  CONSTRAINT contact_enrolment_closures_close_reason_bounded
    CHECK (length(btrim(close_reason)) BETWEEN 1 AND 500),
  -- A reopen is all three fields or none, with a reason, never before the close.
  CONSTRAINT contact_enrolment_closures_reopen_complete
    CHECK ((reopened_by IS NULL AND reopened_at IS NULL AND reopen_reason IS NULL)
        OR (reopened_by IS NOT NULL AND reopened_at IS NOT NULL AND reopen_reason IS NOT NULL
            AND length(btrim(reopen_reason)) BETWEEN 1 AND 500 AND reopened_at >= closed_at)),

  CONSTRAINT contact_enrolment_closures_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  -- COMPOSITE TENANT FK to the prospect spine (canonical_leads' idx_canonical_leads_id_company):
  -- another tenant's prospect is a 23503, never a silent cross-tenant closure.
  CONSTRAINT contact_enrolment_closures_prospect_fk
    FOREIGN KEY (prospect_id, organization_id) REFERENCES public.canonical_leads (id, company_id) ON DELETE CASCADE
);

-- ONE active closure per prospect.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_enrolment_closures_active
  ON public.contact_enrolment_closures (organization_id, prospect_id)
  WHERE reopened_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_contact_enrolment_closures_org_prospect
  ON public.contact_enrolment_closures (organization_id, prospect_id, closed_at);

-- Append-only: a closure never changes, except to be reopened ONCE.
CREATE OR REPLACE FUNCTION public.contact_enrolment_closures_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Set ONLY by g11_redact_enrolment_closure_reasons, transaction-local, cleared at its end.
  v_redact boolean := coalesce(current_setting('g11.redact_closure_reasons', true), '') = 'on';
BEGIN
  -- The one admitted change under the flag: the reasons become the placeholder, nothing else moves.
  IF v_redact
     AND NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.prospect_id IS NOT DISTINCT FROM OLD.prospect_id AND NEW.closed_by IS NOT DISTINCT FROM OLD.closed_by
     AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at AND NEW.reopened_by IS NOT DISTINCT FROM OLD.reopened_by
     AND NEW.reopened_at IS NOT DISTINCT FROM OLD.reopened_at
     AND NEW.close_reason = '[redacted: subject erased]'
     AND ((OLD.reopen_reason IS NULL AND NEW.reopen_reason IS NULL) OR NEW.reopen_reason = '[redacted: subject erased]') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.close_reason IS DISTINCT FROM OLD.close_reason THEN
    RAISE EXCEPTION 'contact_enrolment_closures: closure % is a historical record; only a reopen is recorded on it', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF OLD.reopened_at IS NOT NULL THEN
    RAISE EXCEPTION 'contact_enrolment_closures: closure % is already reopened; a new close is a new row', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM anon;
REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_contact_enrolment_closures_guard ON public.contact_enrolment_closures;
CREATE TRIGGER trg_contact_enrolment_closures_guard
  BEFORE UPDATE ON public.contact_enrolment_closures
  FOR EACH ROW EXECUTE FUNCTION public.contact_enrolment_closures_guard();

ALTER TABLE public.contact_enrolment_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_enrolment_closures_service_role ON public.contact_enrolment_closures;
CREATE POLICY contact_enrolment_closures_service_role ON public.contact_enrolment_closures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.contact_enrolment_closures FROM PUBLIC;
REVOKE ALL ON public.contact_enrolment_closures FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contact_enrolment_closures TO service_role;

-- ── redaction at erasure (PI: close_reason / reopen_reason are MAPPED) ────────────

CREATE OR REPLACE FUNCTION public.g11_redact_enrolment_closure_reasons(
  p_organization_id uuid,
  p_prospect_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_organization_id IS NULL OR p_prospect_ids IS NULL OR array_position(p_prospect_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'g11_redact: organization and prospect ids are required' USING ERRCODE = '22023';
  END IF;
  -- Tenant-scoped: every prospect must belong to this organization.
  IF EXISTS (SELECT 1 FROM unnest(p_prospect_ids) p(id)
              WHERE NOT EXISTS (SELECT 1 FROM public.canonical_leads cl WHERE cl.id = p.id AND cl.company_id = p_organization_id)) THEN
    RAISE EXCEPTION 'g11_redact: a prospect is not in organization %', p_organization_id USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('g11.redact_closure_reasons', 'on', true);
  -- IDEMPOTENT: rows already redacted are not touched again.
  UPDATE public.contact_enrolment_closures c
     SET close_reason  = '[redacted: subject erased]',
         reopen_reason = CASE WHEN c.reopen_reason IS NULL THEN NULL ELSE '[redacted: subject erased]' END
   WHERE c.organization_id = p_organization_id
     AND c.prospect_id = ANY (p_prospect_ids)
     AND (c.close_reason <> '[redacted: subject erased]'
          OR (c.reopen_reason IS NOT NULL AND c.reopen_reason <> '[redacted: subject erased]'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('g11.redact_closure_reasons', 'off', true);
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.g11_redact_enrolment_closure_reasons(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g11_redact_enrolment_closure_reasons(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.g11_redact_enrolment_closure_reasons(uuid, uuid[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.g11_redact_enrolment_closure_reasons(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g11_redact_enrolment_closure_reasons(uuid, uuid[]) TO service_role;

COMMENT ON TABLE public.contact_enrolment_closures IS
  'Orchestration G-11: a company admin''s manual closure of a prospect to NEW journeys (owner: "Also a manual close"). Append-only; reopened once; one active per prospect. Not PI lifecycle.';

-- Postconditions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_contact_enrolment_closures_active') THEN
    RAISE EXCEPTION 'G-11 postcondition: one active closure per prospect is unenforced';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contact_enrolment_closures'::regclass
                  AND conname = 'contact_enrolment_closures_prospect_fk' AND contype = 'f') THEN
    RAISE EXCEPTION 'G-11 postcondition: closures are not tied to a prospect of the same tenant';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contact_enrolment_closures'::regclass) THEN
    RAISE EXCEPTION 'G-11 postcondition: RLS is off on contact_enrolment_closures';
  END IF;
  IF has_table_privilege('authenticated', 'public.contact_enrolment_closures', 'SELECT')
     OR has_table_privilege('anon', 'public.contact_enrolment_closures', 'SELECT')
     OR has_table_privilege('service_role', 'public.contact_enrolment_closures', 'DELETE') THEN
    RAISE EXCEPTION 'G-11 postcondition: a client role can read closures, or a closure can be deleted';
  END IF;
  IF has_function_privilege('anon', 'public.g11_redact_enrolment_closure_reasons(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.g11_redact_enrolment_closure_reasons(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-11 postcondition: a client role can redact closure reasons';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.contact_enrolment_closures'::regclass
                  AND tgname = 'trg_contact_enrolment_closures_guard') THEN
    RAISE EXCEPTION 'G-11 postcondition: the closure guard is missing';
  END IF;
END
$$;
