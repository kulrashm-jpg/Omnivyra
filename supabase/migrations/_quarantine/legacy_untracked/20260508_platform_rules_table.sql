-- ============================================================
-- platform_rules table
-- Required by: campaignPromptBuilder, platformRulesService,
--              platformPromotionStore (listPlatformRules / upsertPlatformRule)
--
-- NOTE: platform_rules_config (20260320) is a separate, jsonb-based
-- config table. This table uses flat columns for bolt pipeline use.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_rules (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform             TEXT        NOT NULL,
  content_type         TEXT        NOT NULL,
  max_length           INTEGER     NULL,
  min_length           INTEGER     NULL,
  allowed_formats      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  frequency_per_week   INTEGER     NOT NULL DEFAULT 1,
  best_days            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  best_times           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  required_fields      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  source               TEXT        NOT NULL DEFAULT 'internal',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, content_type)
);

CREATE INDEX IF NOT EXISTS idx_platform_rules_platform ON platform_rules(platform);

-- Add unique constraint if it doesn't exist (table may have been created without it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'platform_rules'::regclass
      AND contype = 'u'
      AND conname = 'platform_rules_platform_content_type_key'
  ) THEN
    ALTER TABLE platform_rules ADD CONSTRAINT platform_rules_platform_content_type_key UNIQUE (platform, content_type);
  END IF;
END$$;

-- ── Seed: built-in fallback rules ────────────────────────────────────────────
INSERT INTO platform_rules (platform, content_type, max_length, min_length, allowed_formats, frequency_per_week, best_days, best_times, required_fields, source)
VALUES
  ('linkedin',  'text',  3000, 50,  '["text"]'::jsonb,             3, '["Tuesday","Wednesday","Thursday"]'::jsonb, '["09:00"]'::jsonb, '["cta"]'::jsonb,                       'internal'),
  ('instagram', 'image', 2200, 50,  '["image","carousel"]'::jsonb, 4, '["Wednesday","Friday","Sunday"]'::jsonb,    '["19:00"]'::jsonb, '["hashtags"]'::jsonb,                   'internal'),
  ('x',         'text',  280,  10,  '["text"]'::jsonb,             5, '["Tuesday","Thursday"]'::jsonb,             '["12:00"]'::jsonb, '[]'::jsonb,                             'internal'),
  ('youtube',   'video', 5000, 30,  '["video"]'::jsonb,            2, '["Friday"]'::jsonb,                         '["18:00"]'::jsonb, '["cta"]'::jsonb,                        'internal'),
  ('blog',      'blog',  5000, 300, '["blog"]'::jsonb,             2, '["Tuesday"]'::jsonb,                        '["08:00"]'::jsonb, '["seo_title","seo_description"]'::jsonb, 'internal'),
  ('tiktok',    'video', 1500, 15,  '["video"]'::jsonb,            3, '["Thursday","Saturday"]'::jsonb,            '["20:00"]'::jsonb, '["hashtags"]'::jsonb,                   'internal'),
  ('podcast',   'audio', 3600, 60,  '["audio"]'::jsonb,            2, '["Monday"]'::jsonb,                         '["08:00"]'::jsonb, '["cta"]'::jsonb,                        'internal')
ON CONFLICT (platform, content_type) DO NOTHING;
