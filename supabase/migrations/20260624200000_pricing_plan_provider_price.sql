-- Plan-mapping rehabilitation: deterministic Stripe price_id → pricing_plans.id resolution.
-- Adds the mapping column the resolver's priority-B (price_id mapping) needs. Additive,
-- nullable, reversible (DROP COLUMN). No behavior change until populated by ops.

ALTER TABLE public.pricing_plans ADD COLUMN IF NOT EXISTS provider_price_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_plans_provider_price
  ON public.pricing_plans (provider_price_id)
  WHERE provider_price_id IS NOT NULL;
