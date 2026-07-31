-- =============================================================================
-- AI-ORCH-2B.1B — ROLLBACK of the Resolution Decision Catalog.
--
-- Drops the catalog table. Data-loss-free w.r.t. any live feature (no runtime
-- consumer in 2B.1B). IF EXISTS → idempotent. The 2B.1A reason catalog is untouched.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

DROP TABLE IF EXISTS public.ai_resolution_decision_codes;
