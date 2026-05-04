-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260422074957  Name: content_generation_action_pricing
-- Idempotency: GUARDED (ON CONFLICT DO NOTHING).

-- Add content_generation as a distinct action_key (per spec for generate_master
-- migration). Shares pricing shape with content_basic: 3.0x margin, floor 5
-- credits (~$0.05), ceiling 50 credits ($0.50).
INSERT INTO public.action_pricing_config
  (action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active, notes)
VALUES
  ('content_generation', 'llm', 3.0, 0.05, 0.50, true,
   'Master content generation (activity workspace generate_master flow); floor 5 credits, ceiling 50 credits')
ON CONFLICT (action_key) WHERE is_active = true DO NOTHING;
