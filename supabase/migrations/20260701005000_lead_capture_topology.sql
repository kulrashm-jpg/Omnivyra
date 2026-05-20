-- =============================================================================
-- Lead-capture topology (DESIGN ARTIFACT / OPTIONAL)
--
-- Persists the operator-selected lead-capture topology decisions so the
-- onboarding flow + topology-aware diagnostics are durable across sessions
-- and instances. Shipped service uses this table WHEN PRESENT and otherwise
-- falls back to the append-only audit_events substrate — pure observability
-- upgrade, no behaviour change, no regression.
--
-- One ACTIVE topology per company; history is preserved via append-only
-- audit_events (`resource_type='lead_capture_topology'`). The hardened
-- public ingestion routes are unchanged.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical
-- mutation, no backfill. NOT applied by this change — controlled migration
-- process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.lead_capture_topologies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  topologies      text[]      NOT NULL,     -- multi-select: see TopologyKind in service
  attribution_modes text[]    NOT NULL DEFAULT ARRAY[]::text[],
  notes           text,
  recorded_by     uuid,
  active          boolean     NOT NULL DEFAULT true,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lct_company
  ON public.lead_capture_topologies (company_id, recorded_at DESC);

-- At most one active row per company. Application code enforces deactivation
-- of prior rows on insert; the partial unique index makes the invariant
-- DB-enforced too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lct_active
  ON public.lead_capture_topologies (company_id) WHERE active = true;

ALTER TABLE public.lead_capture_topologies ENABLE ROW LEVEL SECURITY;
