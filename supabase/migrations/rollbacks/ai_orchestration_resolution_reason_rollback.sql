-- =============================================================================
-- AI-ORCH-2B.1A — ROLLBACK of the Resolution Reason model.
--
-- Drops the catalog table and the three INERT usage_events columns. Data-loss-free
-- w.r.t. any live feature (nothing populated these in 2B.1A). IF EXISTS → idempotent.
--
-- NOTE: DROP COLUMN takes a brief ACCESS EXCLUSIVE lock on usage_events; run in a
-- low-traffic window if reversing in production.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

ALTER TABLE public.usage_events DROP COLUMN IF EXISTS resolution_reason_detail;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS resolution_reason_category;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS resolution_reason_code;

DROP TABLE IF EXISTS public.ai_resolution_reason_codes;
