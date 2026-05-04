-- Dynamic Baseline Conditioning — extend campaign_versions
-- company_stage, market_scope, baseline_override

ALTER TABLE campaign_versions
  ADD COLUMN IF NOT EXISTS company_stage TEXT DEFAULT 'early_stage'
    CHECK (company_stage IN ('early_stage', 'growth_stage', 'established')),
  ADD COLUMN IF NOT EXISTS market_scope TEXT
    CHECK (market_scope IS NULL OR market_scope IN ('niche', 'regional', 'national', 'global')),
  ADD COLUMN IF NOT EXISTS baseline_override JSONB DEFAULT NULL;

COMMENT ON COLUMN campaign_versions.company_stage IS 'Company stage for baseline computation: early_stage, growth_stage, established';
COMMENT ON COLUMN campaign_versions.market_scope IS 'Campaign market scope (required at creation): niche, regional, national, global';
COMMENT ON COLUMN campaign_versions.baseline_override IS 'Optional override: { platform, followers? } to use instead of platform_metrics_snapshots';
