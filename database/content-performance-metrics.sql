CREATE TABLE IF NOT EXISTS content_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_asset_id UUID NOT NULL REFERENCES content_assets(asset_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  campaign_id TEXT,
  week_number INTEGER,
  day TEXT,
  metrics_json JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_metrics_unique
  ON content_performance_metrics(content_asset_id, platform, captured_at);

CREATE INDEX IF NOT EXISTS idx_content_metrics_campaign
  ON content_performance_metrics(campaign_id);
