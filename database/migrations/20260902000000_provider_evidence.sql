-- BETA-ENGINE-007 — Canonical Provider Evidence persistence (Phase 4)
--
-- Backing table for the canonical Evidence Ingestion & Orchestration layer. One provider-agnostic table;
-- no provider-specific storage. Each row persists a canonical Evidence set for a (provider, subject),
-- carrying the required fields: provider, evidence type/measurement (inside the JSONB), timestamp,
-- freshness, confidence, maturity, source, validation status, and calculation provenance.
--
-- GOVERNANCE: NOT auto-applied in the working environment (.env.local is production; the migration ledger
-- is applied surgically, never via bulk db push). The in-memory `EvidenceStore` is the default; a DB-backed
-- store implementing the same interface persists to this table once applied. Apply via the standard
-- surgical path on a seeded non-production project first.

CREATE TABLE IF NOT EXISTS public.provider_evidence (
  id                uuid            NOT NULL DEFAULT gen_random_uuid(),
  company_id        uuid            NOT NULL,
  provider_id       text            NOT NULL,
  subject_id        text            NOT NULL,
  -- Canonical Evidence[] as produced by the provider adapter (each element carries measurement, unit,
  -- confidence, maturity, provenance, validationStatus, observedAt).
  evidence          jsonb           NOT NULL DEFAULT '[]'::jsonb,
  -- Ingestion metadata.
  fetched_at        timestamptz     NOT NULL,
  status            text            NOT NULL DEFAULT 'ready'
                      CHECK (status IN ('ready', 'refresh_in_progress', 'refresh_failed')),
  failure_reason    text            NULL,
  -- BETA-ENGINE-008 governance metadata (validation + quality + conflicts + validator version).
  governance        jsonb           NULL,
  -- Denormalised freshness + measured flag for cheap engine reads (derived deterministically on write).
  freshness_state   text            NULL
                      CHECK (freshness_state IN ('fresh','stale','expired','refresh_required','refresh_in_progress','refresh_failed')),
  measured          boolean         NOT NULL DEFAULT false,
  created_at        timestamptz     NOT NULL DEFAULT now(),
  updated_at        timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT provider_evidence_pkey PRIMARY KEY (id),
  -- One current record per (company, provider, subject); the orchestrator upserts.
  CONSTRAINT provider_evidence_unique UNIQUE (company_id, provider_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_evidence_lookup
  ON public.provider_evidence (company_id, provider_id, subject_id);

CREATE INDEX IF NOT EXISTS idx_provider_evidence_freshness
  ON public.provider_evidence (freshness_state);

COMMENT ON TABLE public.provider_evidence IS
  'BETA-ENGINE-007: canonical persisted provider Evidence. Provider-agnostic; consumed by evidence-aware decision engines via the ingestion orchestrator (one fetch, many consumers).';
