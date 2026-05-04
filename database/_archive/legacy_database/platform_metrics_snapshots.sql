-- Daily platform metrics snapshots for baseline conditioning
-- Used to read actual follower counts per platform (most recent snapshot only)

CREATE TABLE IF NOT EXISTS platform_metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  followers INTEGER NOT NULL,
  engagement_rate FLOAT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_metrics_company_platform_captured
  ON platform_metrics_snapshots(company_id, platform, captured_at DESC);

COMMENT ON TABLE platform_metrics_snapshots IS 'Daily snapshots of platform metrics per company; baseline conditioning uses latest per platform';
