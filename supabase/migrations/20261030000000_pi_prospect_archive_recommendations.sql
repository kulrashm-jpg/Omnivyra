-- PI-LEAD-FOUNDATION-002 — archive recommendations for canonical prospects.
--
-- AUTHORED, NOT APPLIED. No database was touched to produce this file, and
-- nothing in this workstream applies or deploys it.
--
-- ─── WHY A TABLE, AND WHY ONLY ONE ─────────────────────────────────────────
-- The owner-approved contract is "AI recommends; user confirms". That needs a
-- durable object that is NOT the prospect: a recommendation must be able to
-- exist, be reviewed, and be rejected WITHOUT the prospect's state moving. A
-- boolean on the person could not express "recommended but not archived", which
-- is precisely the state the whole contract is about.
--
-- ─── WHAT IS DELIBERATELY *NOT* CREATED ────────────────────────────────────
-- No new status model. `unified_persons.status` already carries the ADR §2
-- vocabulary ('active','merged','suppressed','archived'), is already
-- tenant-scoped (idx_unified_persons_company_status) and is already the thing
-- `person_duplicate_candidates` reads to decide who may be a duplicate.
-- Archiving therefore SETS THAT COLUMN. `canonical_leads.lead_status` is
-- deliberately not used: it is free text with no CHECK, PI never reads it, and
-- giving it meaning here would create a second, unconstrained status model —
-- exactly what this workstream was told not to do.
--
-- ─── ARCHIVE IS NOT DNC, AND THE SCHEMA SAYS SO ────────────────────────────
-- Suppression lives in `contact_governance_records` and is untouched here.
-- Nothing in this file writes, reads or references it. A prospect may be
-- archived-and-contactable or active-and-suppressed; the two axes are separate
-- tables on purpose, so no single flag can collapse them.
--
-- ─── AND ARCHIVE IS NOT DELETION ───────────────────────────────────────────
-- No DELETE, no CASCADE onto evidence, no retention change. Source records,
-- assertions, enrichment attempts and engagement history are untouched by
-- archiving and remain queryable. The FK below is ON DELETE CASCADE only so a
-- recommendation cannot outlive the person it is about — that is referential
-- hygiene, not a retention policy.

-- ── the recommendation ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_archive_recommendations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  person_id            uuid NOT NULL,

  -- WHY the recommendation was made. A closed vocabulary, because an
  -- unexplainable recommendation cannot be reviewed, and the contract requires
  -- the reviewing human to see the reasoning.
  reason               text NOT NULL,
  -- Free-text explanation intended for the reviewing human.
  reasoning            text,
  -- Pointers to the evidence, NEVER a copy of it. A recommendation that
  -- duplicated evidence would let the two drift apart.
  evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Which rule set or model produced it, so a recommendation stays traceable to
  -- the thing that made it.
  model_version        text,

  status               text NOT NULL DEFAULT 'open',

  recommended_at       timestamptz NOT NULL DEFAULT now(),

  -- Review. All three are null until a human acts, and the CHECK below makes a
  -- reviewed row without a reviewer impossible.
  reviewed_by_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  reviewed_at          timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),

  -- TENANT INTEGRITY: composite, so a recommendation cannot be attached to a
  -- person in another tenant. Parent key is uq_unified_persons_id_company.
  CONSTRAINT prospect_archive_rec_person_tenant_fk
    FOREIGN KEY (person_id, organization_id)
    REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE,

  CONSTRAINT prospect_archive_rec_status_valid
    CHECK (status IN ('open', 'confirmed', 'rejected', 'superseded')),

  CONSTRAINT prospect_archive_rec_reason_valid
    CHECK (reason IN (
      'no_response_after_repeated_outreach',
      'prolonged_inactivity',
      'stale_or_invalid_contact_data',
      'repeated_enrichment_failure',
      'insufficient_identity_confidence',
      'no_longer_matches_targeting'
    )),

  -- A reviewed recommendation names its reviewer and when. An OPEN one names
  -- neither. This is what stops a recommendation from silently appearing to
  -- have been confirmed by nobody.
  CONSTRAINT prospect_archive_rec_review_coherent
    CHECK (
      (status = 'open'       AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
      OR (status = 'superseded')
      OR (status IN ('confirmed', 'rejected')
          AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

-- At most ONE open recommendation per person per tenant. Partial, so confirmed
-- and rejected history accumulates freely — the history is the audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_archive_rec_open
  ON public.prospect_archive_recommendations (organization_id, person_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_prospect_archive_rec_tenant_status
  ON public.prospect_archive_recommendations (organization_id, status, recommended_at DESC);

-- ── RLS: deny by default, service_role only ────────────────────────────────
-- Defence in depth, exactly as the sibling PI tables state it: the backend uses
-- the service-role client, so this is NOT the tenant boundary. Tenant isolation
-- is the composite FK above plus the application guard on the route.
ALTER TABLE public.prospect_archive_recommendations ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'prospect_archive_recommendations'
      AND policyname = 'prospect_archive_rec_service_role_full_access'
  ) THEN
    CREATE POLICY prospect_archive_rec_service_role_full_access
      ON public.prospect_archive_recommendations
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$rls$;

REVOKE ALL ON public.prospect_archive_recommendations FROM anon, authenticated;

COMMENT ON TABLE public.prospect_archive_recommendations IS
  'PI archive recommendations. AI recommends; a human confirms. A recommendation '
  'never changes unified_persons.status by itself — confirmation does. Archive is '
  'not deletion and not DNC: contact_governance_records is a separate axis.';
