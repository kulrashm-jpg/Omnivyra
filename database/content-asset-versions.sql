CREATE TABLE IF NOT EXISTS content_asset_versions (
  version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES content_assets(asset_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_json JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_versions_asset
  ON content_asset_versions(asset_id);
