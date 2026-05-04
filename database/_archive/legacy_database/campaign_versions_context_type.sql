-- Hybrid Context Mode + Weighted Campaign Classification
-- Extend campaign_versions only. No changes to campaigns table.

ALTER TABLE campaign_versions
  ADD COLUMN IF NOT EXISTS build_mode TEXT DEFAULT 'full_context'
    CHECK (build_mode IN ('full_context', 'focused_context', 'no_context')),
  ADD COLUMN IF NOT EXISTS context_scope JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS campaign_types JSONB DEFAULT '["brand_awareness"]'::jsonb,
  ADD COLUMN IF NOT EXISTS campaign_weights JSONB DEFAULT '{"brand_awareness": 100}'::jsonb;

COMMENT ON COLUMN campaign_versions.build_mode IS 'Context injection mode: full_context, focused_context, no_context';
COMMENT ON COLUMN campaign_versions.context_scope IS 'Scopes for focused_context: commercial_strategy, marketing_intelligence, campaign_purpose, brand_positioning, competitive_advantages, growth_priorities';
COMMENT ON COLUMN campaign_versions.campaign_types IS 'Allowed: brand_awareness, network_expansion, lead_generation, authority_positioning, engagement_growth, product_promotion';
COMMENT ON COLUMN campaign_versions.campaign_weights IS 'Weights per type, must sum to 100 when types.length > 1';
