-- =============================================================================
-- AI-ORCH-2B.1 — ROLLBACK of the AI Orchestration Foundation.
--
-- Drops every structure created by 20260906000000_ai_orchestration_foundation.sql.
-- Because those tables are new and NOTHING in the application reads them in Phase
-- 2B.1, dropping them is a complete, data-loss-free reversal (no production data
-- ever lived here). Order respects FK dependencies; IF EXISTS makes it idempotent.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- Drop the circular FK first so the profiles table can be dropped cleanly.
ALTER TABLE IF EXISTS public.ai_execution_profiles
  DROP CONSTRAINT IF EXISTS ai_execution_profiles_active_version_fk;

DROP TABLE IF EXISTS public.ai_config_versions;
DROP TABLE IF EXISTS public.ai_operation_capability_map;
DROP TABLE IF EXISTS public.ai_capability_profile_bindings;
DROP TABLE IF EXISTS public.ai_execution_profile_versions;
DROP TABLE IF EXISTS public.ai_execution_profiles;
DROP TABLE IF EXISTS public.ai_routing_policies;
DROP TABLE IF EXISTS public.ai_model_versions;
DROP TABLE IF EXISTS public.ai_model_families;
