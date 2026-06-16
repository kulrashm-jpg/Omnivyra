-- ============================================================
-- Unified Brand Runtime — Phase 1A: Schema (DATA MODEL ONLY)
-- ============================================================
-- Introduces the persistent brand-identity data model that the
-- forthcoming BrandRuntime (Phase 1B resolver + Phase 1C adapter)
-- will read. This migration is SCHEMA ONLY:
--   - No runtime, no resolver, no cache, no adapter.
--   - No consumer is wired. Nothing reads these tables yet.
--   - No existing table is altered. No code path changes.
--
-- MODEL (per approved Phase 1 design):
--   company_brand_identity          — immutable, versioned brand
--                                     snapshots (one row per version).
--   company_brand_identity_pointer  — per-company head pointer to the
--                                     current published + draft versions.
--   Draft/published/preview/rollback/history are all expressed through
--   these two tables: append a new version row; move the pointer to
--   publish; point at a prior version to roll back; preview reads the
--   draft version.
--
-- BOUNDARY (per governance audit): this stores brand DATA only
--   (colors/typography/voice/vocabulary/compliance shape/etc).
--   Governance ENFORCEMENT and CONTENT messaging remain in their
--   existing systems (brandGovernanceEngine, creativeReviewStateMachine,
--   company_profiles / CompanyIdentity) — not duplicated here.
--
-- SAFETY:
--   - Purely additive (CREATE TABLE IF NOT EXISTS, CREATE INDEX
--     IF NOT EXISTS). Idempotent.
--   - No backfill. Tables start empty; tenants without a row are
--     resolved from defaults by Phase 1B (byte-identical behavior).
--   - No RLS (backend/service-role accessed, mirroring active_leads
--     and peer per-company backend tables).
--
-- ROLLBACK (forward-only repo; manual if ever needed):
--   DROP TABLE IF EXISTS company_brand_identity_pointer;
--   DROP TABLE IF EXISTS company_brand_identity;
--   No other object is touched; dropping affects only these two
--   (currently empty, unconsumed) tables.
-- ============================================================

-- ── 1. Immutable, versioned brand snapshots ─────────────────
CREATE TABLE IF NOT EXISTS company_brand_identity (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Monotonic per-company version. A new edit = a new row.
  version           INTEGER NOT NULL,

  -- Lifecycle state of THIS version row (brand-config lifecycle —
  -- distinct from the content-asset lifecycle in
  -- creativeReviewStateMachine). v1 = draft | published.
  status            TEXT NOT NULL DEFAULT 'draft',

  -- Brand DATA facets (JSONB so the contract extends without
  -- further migrations). All optional; empty object = "use defaults".
  colors            JSONB NOT NULL DEFAULT '{}'::jsonb,
  typography        JSONB NOT NULL DEFAULT '{}'::jsonb,
  logo_assets       JSONB NOT NULL DEFAULT '{}'::jsonb,
  voice             JSONB NOT NULL DEFAULT '{}'::jsonb,
  vocabulary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  compliance        JSONB NOT NULL DEFAULT '{}'::jsonb,
  design_language   JSONB NOT NULL DEFAULT '{}'::jsonb,
  tagline           TEXT NULL,

  -- 0..1 brand-completeness score (computed by Phase 1B; stored for
  -- operator surfacing).
  completeness      NUMERIC NULL,
  identity_hash     TEXT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at      TIMESTAMPTZ NULL,
  updated_by        UUID NULL REFERENCES users(id) ON DELETE SET NULL,

  -- (company_id, version) is the natural key the pointer references.
  CONSTRAINT company_brand_identity_version_unique
    UNIQUE (company_id, version),

  CONSTRAINT company_brand_identity_status_check
    CHECK (status IN ('draft', 'published')),

  CONSTRAINT company_brand_identity_version_positive
    CHECK (version >= 1),

  CONSTRAINT company_brand_identity_completeness_bounds
    CHECK (completeness IS NULL OR completeness BETWEEN 0 AND 1)
);

-- Lookup: latest published/draft per company.
CREATE INDEX IF NOT EXISTS idx_company_brand_identity_company_status_version
  ON company_brand_identity (company_id, status, version DESC);

-- ── 2. Per-company head pointer (published + draft) ─────────
CREATE TABLE IF NOT EXISTS company_brand_identity_pointer (
  company_id        UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,

  -- Current published version (NULL until first publish).
  published_version INTEGER NULL,

  -- Active draft version (NULL when no draft).
  draft_version     INTEGER NULL,

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Pointer integrity: each non-null pointer must reference a real
  -- (company_id, version) snapshot. NULL pointers are unconstrained
  -- (MATCH SIMPLE). Version rows are immutable, so NO ACTION is safe;
  -- company deletion cascades both tables via their companies FK.
  CONSTRAINT company_brand_identity_pointer_published_fk
    FOREIGN KEY (company_id, published_version)
    REFERENCES company_brand_identity (company_id, version),

  CONSTRAINT company_brand_identity_pointer_draft_fk
    FOREIGN KEY (company_id, draft_version)
    REFERENCES company_brand_identity (company_id, version)
);
