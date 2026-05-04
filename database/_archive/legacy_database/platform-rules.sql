CREATE TABLE IF NOT EXISTS platform_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  content_type TEXT NOT NULL,
  max_length INTEGER,
  min_length INTEGER,
  allowed_formats JSONB,
  frequency_per_week INTEGER,
  best_days JSONB,
  best_times JSONB,
  required_fields JSONB,
  source TEXT DEFAULT 'internal',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_rules_platform
  ON platform_rules(platform);
