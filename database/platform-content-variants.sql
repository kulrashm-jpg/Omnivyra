CREATE TABLE IF NOT EXISTS platform_content_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_asset_id UUID NOT NULL REFERENCES content_assets(asset_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  formatted_content TEXT,
  character_count INTEGER,
  media_placeholder BOOLEAN DEFAULT false,
  compliance_status TEXT DEFAULT 'warning',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_variants_asset
  ON platform_content_variants(content_asset_id);
