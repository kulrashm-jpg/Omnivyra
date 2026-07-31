-- =============================================================================
-- AI-ORCH-2B.1 — AI Orchestration Foundation (persistence layer ONLY).
--
-- Introduces the new persistence structures for the approved AI Orchestration
-- architecture (Phase 2A design: docs/ai-architecture/AI-ORCHESTRATION-PHASE-2A-DESIGN.md):
--   Execution Profiles · Profile Versions · Capability Bindings · Routing Policies
--   · Model Families · Model Versions · Config Versions · Operation→Capability map.
--
-- SCOPE: PERSISTENCE ONLY. No resolver, no gateway change, no runtime consumer.
-- Nothing in the application reads these tables in Phase 2B.1. When all
-- AI_* feature flags are OFF (their default), behavior is byte-identical to today.
--
-- SAFETY:
--   - Purely ADDITIVE — CREATE TABLE IF NOT EXISTS only; no existing table altered
--     here (extensions live in the sibling ..._extensions migration).
--   - Idempotent — safe to re-run.
--   - Reversible — see 20260906000000_ai_orchestration_foundation_rollback.sql.
--   - Org scoping uses a bare UUID `org_id` with NO hard FK, mirroring the
--     existing company_llm_configs.company_id convention (no coupling to the
--     companies/organizations table name).
--   - capability_id is TEXT (the CAPABILITY_REGISTRY id, e.g. 'CONTENT_WRITER') —
--     capabilities live in code, not a DB table, so there is no FK.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- ── ai_model_families ─────────────────────────────────────────────────────────
-- Groups models under a provider family (e.g. openai → "gpt-4o").
CREATE TABLE IF NOT EXISTS public.ai_model_families (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID        NOT NULL REFERENCES public.llm_providers(id) ON DELETE CASCADE,
  family_key   TEXT        NOT NULL,                  -- e.g. "gpt-4o"
  display_name TEXT        NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, family_key)
);

-- ── ai_model_versions ─────────────────────────────────────────────────────────
-- Version pinning + lifecycle per model. `is_default` marks the "latest" target.
CREATE TABLE IF NOT EXISTS public.ai_model_versions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id      UUID        NOT NULL REFERENCES public.llm_models(id) ON DELETE CASCADE,
  version_tag   TEXT        NOT NULL,                 -- e.g. "gpt-4o-mini-2024-07-18"
  is_default    BOOLEAN     NOT NULL DEFAULT false,   -- the "latest" resolution target
  status        TEXT        NOT NULL DEFAULT 'active' -- active | deprecated | retired
                CHECK (status IN ('active','deprecated','retired')),
  released_at   TIMESTAMPTZ NULL,
  deprecated_at TIMESTAMPTZ NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, version_tag)
);

-- ── ai_routing_policies ───────────────────────────────────────────────────────
-- Ordered provider chain (primary → secondary → fallback) + circuit-breaker
-- policy. Referenced by a profile version. INERT until Phase 2A-7.
CREATE TABLE IF NOT EXISTS public.ai_routing_policies (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                    TEXT        NOT NULL UNIQUE,          -- e.g. "openai-primary"
  display_name           TEXT        NOT NULL,
  -- Ordered chain: [{ "provider":"openai","role":"primary" }, ...]
  providers              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  circuit_breaker_policy JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ai_execution_profiles ─────────────────────────────────────────────────────
-- Profile pointer → current active immutable version. `active_version_id` is
-- nullable to allow the profile row to be inserted before its first version
-- (the circular FK between profile ⇄ version is resolved by nullability).
CREATE TABLE IF NOT EXISTS public.ai_execution_profiles (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 TEXT        NOT NULL UNIQUE,      -- e.g. "BALANCED"
  name                TEXT        NOT NULL,
  description         TEXT        NULL,
  active_version_id   UUID        NULL,                 -- FK added after versions table exists (below)
  is_platform_default BOOLEAN     NOT NULL DEFAULT false,
  requires_approval   BOOLEAN     NOT NULL DEFAULT false,
  created_by          UUID        NULL,
  updated_by          UUID        NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ai_execution_profile_versions ─────────────────────────────────────────────
-- Immutable snapshot of a profile at a version. Resolution stamps the exact
-- version into usage_events so a config change never rewrites past behavior.
CREATE TABLE IF NOT EXISTS public.ai_execution_profile_versions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id              UUID        NOT NULL REFERENCES public.ai_execution_profiles(id) ON DELETE CASCADE,
  version                 INT         NOT NULL,
  -- 'tier' = provider-agnostic (quality_tier + requirements); 'explicit' = pinned.
  mode                    TEXT        NOT NULL DEFAULT 'tier'
                          CHECK (mode IN ('tier','explicit')),
  quality_tier            TEXT        NULL              -- economy | balanced | high | frontier
                          CHECK (quality_tier IS NULL OR quality_tier IN ('economy','balanced','high','frontier')),
  capability_requirements JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Explicit-mode selection (all nullable; used only when mode='explicit').
  provider_id             UUID        NULL REFERENCES public.llm_providers(id) ON DELETE SET NULL,
  model_family_id         UUID        NULL REFERENCES public.ai_model_families(id) ON DELETE SET NULL,
  model_id                UUID        NULL REFERENCES public.llm_models(id) ON DELETE SET NULL,
  model_version_tag       TEXT        NULL,
  deployment_id           TEXT        NULL,
  routing_policy_id       UUID        NULL REFERENCES public.ai_routing_policies(id) ON DELETE SET NULL,
  -- Execution config bundles (shape validated at the application layer, not the DB).
  params                  JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- temperature, top_p, max_output_tokens, reasoning_level, seed_policy, ...
  modality                JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- streaming, structured_output, response_format, tool_calling, vision, image_params
  reliability             JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- timeout_ms, max_retries, retry_policy, circuit_breaker_policy_id, partial_allowed
  limits                  JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- max_cost_usd_per_call, token_ceiling, rate_limit_hint
  caching                 JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- cacheable, cache_ttl_seconds
  safety                  JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- moderation, safety_policy_id, prompt_injection_guard
  status                  TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','deprecated','archived')),
  created_by              UUID        NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

-- Resolve the circular pointer: ai_execution_profiles.active_version_id → versions.
-- Added after the versions table exists. Guarded so re-runs do not duplicate it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_execution_profiles_active_version_fk'
      AND table_name = 'ai_execution_profiles'
  ) THEN
    ALTER TABLE public.ai_execution_profiles
      ADD CONSTRAINT ai_execution_profiles_active_version_fk
      FOREIGN KEY (active_version_id)
      REFERENCES public.ai_execution_profile_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── ai_capability_profile_bindings ────────────────────────────────────────────
-- Binds a capability (and/or org) to an Execution Profile at a precedence scope.
-- INERT until Phase 2A-3 (resolver authoritative).
CREATE TABLE IF NOT EXISTS public.ai_capability_profile_bindings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id TEXT        NULL,                        -- CAPABILITY_REGISTRY id; NULL = org-wide
  org_id        UUID        NULL,                        -- NULL = platform scope (no hard FK — see header)
  profile_id    UUID        NOT NULL REFERENCES public.ai_execution_profiles(id) ON DELETE CASCADE,
  override_patch JSONB      NOT NULL DEFAULT '{}'::jsonb, -- sparse field-level overrides deep-merged onto the profile
  scope         TEXT        NOT NULL
                CHECK (scope IN ('platform_default','capability_default','org_default','capability_override')),
  priority      INT         NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  updated_by    UUID        NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active binding per (org, capability) coordinate. NULLs distinguish scopes;
-- COALESCE sentinels make the uniqueness total (Postgres treats NULLs as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_capability_binding_coord
  ON public.ai_capability_profile_bindings (
    COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(capability_id, '*')
  )
  WHERE is_active = true;

-- ── ai_operation_capability_map ───────────────────────────────────────────────
-- Maps a legacy gateway `operation` name → a CAPABILITY_REGISTRY capability id,
-- so every one of the ~130 consumers has a resolution path without a call-site
-- change. INERT until Phase 2A-3.
CREATE TABLE IF NOT EXISTS public.ai_operation_capability_map (
  operation     TEXT        PRIMARY KEY,
  capability_id TEXT        NOT NULL,
  notes         TEXT        NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ai_config_versions ────────────────────────────────────────────────────────
-- Monotonic global config version for future cache invalidation. NOT integrated
-- in Phase 2B.1 — the resolver (Phase 2A-3) will fold `version` into its cache key.
CREATE TABLE IF NOT EXISTS public.ai_config_versions (
  id            BIGSERIAL   PRIMARY KEY,
  version       BIGINT      NOT NULL,
  changed_table TEXT        NULL,
  changed_by    TEXT        NOT NULL DEFAULT 'system',
  note          TEXT        NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes (on new, empty tables — cheap) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_model_families_provider   ON public.ai_model_families(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_model_versions_model      ON public.ai_model_versions(model_id, is_default);
CREATE INDEX IF NOT EXISTS idx_ai_model_versions_status     ON public.ai_model_versions(status);
CREATE INDEX IF NOT EXISTS idx_ai_profile_versions_profile  ON public.ai_execution_profile_versions(profile_id, version);
CREATE INDEX IF NOT EXISTS idx_ai_profiles_platform_default ON public.ai_execution_profiles(is_platform_default) WHERE is_platform_default = true;
CREATE INDEX IF NOT EXISTS idx_ai_bindings_lookup           ON public.ai_capability_profile_bindings(org_id, capability_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_bindings_scope            ON public.ai_capability_profile_bindings(scope, priority);
CREATE INDEX IF NOT EXISTS idx_ai_config_versions_version   ON public.ai_config_versions(version DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Matches the admin-config convention (20260320_admin_config_tables.sql): enable
-- RLS; the service-role backend bypasses it, and writes go through authenticated
-- admin API routes (Phase 2A-5), never direct client DB access.
ALTER TABLE public.ai_model_families               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_versions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_routing_policies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_execution_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_execution_profile_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_capability_profile_bindings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_operation_capability_map     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config_versions              ENABLE ROW LEVEL SECURITY;
