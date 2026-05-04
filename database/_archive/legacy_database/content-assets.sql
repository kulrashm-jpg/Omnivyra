CREATE TABLE IF NOT EXISTS content_assets (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  week_number INTEGER NOT NULL,
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  current_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_assets_campaign_week
  ON content_assets(campaign_id, week_number);
