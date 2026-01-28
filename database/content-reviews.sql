CREATE TABLE IF NOT EXISTS content_reviews (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES content_assets(asset_id) ON DELETE CASCADE,
  reviewer TEXT,
  status TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_reviews_asset
  ON content_reviews(asset_id);
