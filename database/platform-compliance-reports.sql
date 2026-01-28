CREATE TABLE IF NOT EXISTS platform_compliance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_asset_id UUID NOT NULL REFERENCES content_assets(asset_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  violations JSONB,
  warnings JSONB,
  status TEXT DEFAULT 'warning',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_compliance_asset
  ON platform_compliance_reports(content_asset_id);
