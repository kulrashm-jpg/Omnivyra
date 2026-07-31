-- =============================================================================
-- AI-ORCH-2B.1 — ROLLBACK of the existing-table extensions.
--
-- Drops the FK constraints and the additive nullable columns added by
-- 20260906000001_ai_orchestration_extensions.sql. Since these columns are INERT
-- in Phase 2B.1 (never read or written), dropping them is data-loss-free with
-- respect to any live feature. IF EXISTS makes it idempotent.
--
-- NOTE: DROP COLUMN takes a brief ACCESS EXCLUSIVE lock on usage_events; run in a
-- low-traffic window if reversing in production.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- FKs first.
ALTER TABLE IF EXISTS public.company_llm_configs DROP CONSTRAINT IF EXISTS company_llm_configs_default_profile_fk;
ALTER TABLE IF EXISTS public.llm_models          DROP CONSTRAINT IF EXISTS llm_models_model_family_fk;

-- usage_events
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS resolution_source;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS fallback_used;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS resolved_provider;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS capability_id;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS profile_version;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS execution_profile_id;

-- company_llm_configs
ALTER TABLE public.company_llm_configs DROP COLUMN IF EXISTS default_profile_id;
ALTER TABLE public.company_llm_configs DROP COLUMN IF EXISTS deployment_id;

-- llm_models
ALTER TABLE public.llm_models DROP COLUMN IF EXISTS default_version_tag;
ALTER TABLE public.llm_models DROP COLUMN IF EXISTS context_window;
ALTER TABLE public.llm_models DROP COLUMN IF EXISTS supports_tools;
ALTER TABLE public.llm_models DROP COLUMN IF EXISTS supports_vision;
ALTER TABLE public.llm_models DROP COLUMN IF EXISTS supports_structured;
ALTER TABLE public.llm_models DROP COLUMN IF EXISTS supports_streaming;
ALTER TABLE public.llm_models DROP COLUMN IF EXISTS model_family_id;

-- llm_providers
ALTER TABLE public.llm_providers DROP COLUMN IF EXISTS is_byok_allowed;
ALTER TABLE public.llm_providers DROP COLUMN IF EXISTS supports_deployment;
ALTER TABLE public.llm_providers DROP COLUMN IF EXISTS endpoint_url;
ALTER TABLE public.llm_providers DROP COLUMN IF EXISTS priority;
