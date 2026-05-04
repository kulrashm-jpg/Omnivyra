ALTER TABLE action_pricing_config
  ADD COLUMN IF NOT EXISTS minimum_charge_usd numeric(20, 10) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ceiling_usd numeric(20, 10);

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS total_cost_usd numeric(20, 10),
  ADD COLUMN IF NOT EXISTS final_price_usd numeric(20, 10);

INSERT INTO action_pricing_config (
  action_key,
  cost_multiplier,
  minimum_charge_usd,
  ceiling_usd,
  effective_from,
  is_active,
  notes
)
SELECT
  c.action_type,
  1.0,
  0,
  NULL,
  now(),
  true,
  'seeded for deterministic cost engine'
FROM credit_cost_config c
WHERE NOT EXISTS (
  SELECT 1
  FROM action_pricing_config a
  WHERE a.action_key = c.action_type
    AND a.is_active = true
);

INSERT INTO action_pricing_config (
  action_key,
  cost_multiplier,
  minimum_charge_usd,
  ceiling_usd,
  effective_from,
  is_active,
  notes
)
SELECT seed.action_key, 1.0, 0, NULL, now(), true, 'seeded for deterministic cost engine'
FROM (VALUES ('embedding'), ('external_api')) AS seed(action_key)
WHERE NOT EXISTS (
  SELECT 1
  FROM action_pricing_config a
  WHERE a.action_key = seed.action_key
    AND a.is_active = true
);

UPDATE usage_events
SET
  provider = COALESCE(provider, provider_name),
  model = COALESCE(model, model_name),
  total_cost_usd = COALESCE(total_cost_usd, total_cost)
WHERE provider IS NULL
   OR model IS NULL
   OR total_cost_usd IS NULL;
