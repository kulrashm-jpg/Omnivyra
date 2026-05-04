-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260422075406  Name: usage_events_input_output_cost_split
-- Idempotency: GUARDED (ADD COLUMN IF NOT EXISTS).

-- Add per-leg cost columns so per-input/per-output margin analysis is possible
-- without replaying tokens × pricing_snapshot. Aligns usage_events with the
-- canonical ResolvedLlmCost structure.
ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS input_cost_usd  NUMERIC,
  ADD COLUMN IF NOT EXISTS output_cost_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS final_price_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS total_cost_usd  NUMERIC;

-- Mirror on unified_transactions for analytics consistency.
ALTER TABLE public.unified_transactions
  ADD COLUMN IF NOT EXISTS input_cost_usd  NUMERIC,
  ADD COLUMN IF NOT EXISTS output_cost_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS final_price_usd NUMERIC;
