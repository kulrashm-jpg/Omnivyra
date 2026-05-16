-- =====================================================================
-- BILLING SCHEMA ALIGNMENT PRELUDE  (run BEFORE the activation bundle)
--
-- Additive, idempotent fixes that align pre-existing production tables
-- with what the billing migrations (20260663/64/65) expect. Each
-- statement is ADD COLUMN IF NOT EXISTS / OR REPLACE only — no data
-- change, no drops. Derived from a transactional dry-run against prod.
-- =====================================================================

-- 20260663 v_pricing_catalog selects apc.updated_at, but prod's
-- action_pricing_config has only created_at. Add the expected column.
ALTER TABLE public.action_pricing_config
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
