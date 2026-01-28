CREATE TABLE IF NOT EXISTS promotion_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_asset_id UUID NOT NULL REFERENCES content_assets(asset_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  hashtags JSONB,
  keywords JSONB,
  seo_title TEXT,
  seo_description TEXT,
  meta_tags JSONB,
  alt_text TEXT,
  cta TEXT,
  confidence INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_metadata_asset
  ON promotion_metadata(content_asset_id);
