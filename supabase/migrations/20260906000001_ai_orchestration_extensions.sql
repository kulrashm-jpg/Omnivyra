-- =============================================================================
-- AI-ORCH-2B.1 — Existing-table extensions for AI Orchestration.
--
-- Adds APPROVED (Phase 2A §7.2), nullable, backward-compatible columns to four
-- existing tables. Every column is:
--   - ADD COLUMN IF NOT EXISTS  → idempotent + collision-safe
--   - NULLABLE with NO default  → a catalog-only change in PostgreSQL (no table
--     rewrite, no long lock) even on large hot tables like usage_events
--   - INERT — nothing reads or writes these columns in Phase 2B.1. They are
--     populated only in later phases (resolver / observability), each flag-gated.
--
-- Depends on 20260906000000_ai_orchestration_foundation.sql (references the new
-- ai_model_families / ai_execution_profiles tables). Migration ordering by
-- filename timestamp guarantees the foundation runs first.
--
-- DELIBERATELY DEFERRED: the usage_events analytics indexes from Phase 2A §7.4
-- (execution_profile_id / capability_id) are NOT created here. Building an index
-- on the large usage_events table has no consumer until the observability phase,
-- so it is deferred to that phase to keep 2B.1 a pure, low-risk foundation.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- ── llm_providers — routing/priority + BYOK/deployment capability flags ───────
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS priority           INT     NULL;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS endpoint_url       TEXT    NULL;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS supports_deployment BOOLEAN NULL;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS is_byok_allowed    BOOLEAN NULL;

-- ── llm_models — family linkage, per-model capability flags, version default ──
ALTER TABLE public.llm_models ADD COLUMN IF NOT EXISTS model_family_id     UUID    NULL;
ALTER TABLE public.llm_models ADD COLUMN IF NOT EXISTS supports_streaming  BOOLEAN NULL;
ALTER TABLE public.llm_models ADD COLUMN IF NOT EXISTS supports_structured BOOLEAN NULL;
ALTER TABLE public.llm_models ADD COLUMN IF NOT EXISTS supports_vision     BOOLEAN NULL;
ALTER TABLE public.llm_models ADD COLUMN IF NOT EXISTS supports_tools      BOOLEAN NULL;
ALTER TABLE public.llm_models ADD COLUMN IF NOT EXISTS context_window      INT     NULL;
ALTER TABLE public.llm_models ADD COLUMN IF NOT EXISTS default_version_tag TEXT    NULL;

-- FK for the family linkage (nullable → SET NULL on family delete). Guarded.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'llm_models_model_family_fk'
      AND table_name = 'llm_models'
  ) THEN
    ALTER TABLE public.llm_models
      ADD CONSTRAINT llm_models_model_family_fk
      FOREIGN KEY (model_family_id)
      REFERENCES public.ai_model_families(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── company_llm_configs — deployment id + org-wide default-profile shortcut ───
ALTER TABLE public.company_llm_configs ADD COLUMN IF NOT EXISTS deployment_id     TEXT NULL;
ALTER TABLE public.company_llm_configs ADD COLUMN IF NOT EXISTS default_profile_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'company_llm_configs_default_profile_fk'
      AND table_name = 'company_llm_configs'
  ) THEN
    ALTER TABLE public.company_llm_configs
      ADD CONSTRAINT company_llm_configs_default_profile_fk
      FOREIGN KEY (default_profile_id)
      REFERENCES public.ai_execution_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── usage_events — resolution provenance dimensions (INERT; observability later) ─
-- Nullable, no default → fast catalog-only change on the hot billing table. No
-- index created here (see the deferral note in the header).
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS execution_profile_id UUID    NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS profile_version      INT     NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS capability_id        TEXT    NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS resolved_provider    TEXT    NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS fallback_used        BOOLEAN NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS resolution_source    TEXT    NULL;
