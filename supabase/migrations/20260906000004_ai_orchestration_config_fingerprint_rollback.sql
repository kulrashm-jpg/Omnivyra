-- =============================================================================
-- AI-ORCH-2B.1A — ROLLBACK of the Configuration Fingerprint.
--
-- Removes the audit row and drops the two INERT columns from the immutable version
-- snapshot. Data-loss-free w.r.t. any live feature. IF EXISTS → idempotent.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

DELETE FROM public.config_change_logs WHERE config_type = 'ai_config_fingerprint_seed';

ALTER TABLE public.ai_execution_profile_versions DROP COLUMN IF EXISTS fingerprint_algo;
ALTER TABLE public.ai_execution_profile_versions DROP COLUMN IF EXISTS config_fingerprint;
