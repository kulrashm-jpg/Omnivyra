-- =============================================================================
-- AI-ORCH-2B.1B — ROLLBACK of fingerprint version separation.
--
-- Drops the three separated columns + the audit row. The legacy config_fingerprint
-- and fingerprint_algo columns are left intact (they were never touched). IF EXISTS
-- → idempotent; data-loss-free w.r.t. any live feature.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

DELETE FROM public.config_change_logs WHERE config_type = 'ai_fingerprint_version_separation';

ALTER TABLE public.ai_execution_profile_versions DROP COLUMN IF EXISTS fingerprint_algorithm;
ALTER TABLE public.ai_execution_profile_versions DROP COLUMN IF EXISTS canonicalization_version;
ALTER TABLE public.ai_execution_profile_versions DROP COLUMN IF EXISTS execution_schema_version;
