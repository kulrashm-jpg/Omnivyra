-- =====================================================
-- PLATFORM REGISTRY
-- Controlled list of supported social platforms.
-- platform_key is the canonical identifier used across the system.
-- =====================================================

CREATE TABLE IF NOT EXISTS platform_registry (
  platform_key TEXT PRIMARY KEY,
  platform_label TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'oauth',
  supports_publishing BOOLEAN NOT NULL DEFAULT true,
  supports_replies BOOLEAN NOT NULL DEFAULT true,
  supports_comments BOOLEAN NOT NULL DEFAULT true,
  supports_threads BOOLEAN NOT NULL DEFAULT false,
  supports_video BOOLEAN NOT NULL DEFAULT false,
  supports_ingestion BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE platform_registry ADD COLUMN IF NOT EXISTS platform_category TEXT DEFAULT 'social';

UPDATE platform_registry SET platform_category = 'social' WHERE platform_category IS NULL;

-- Seed platforms (social)
INSERT INTO platform_registry (
  platform_key,
  platform_label,
  api_base_url,
  auth_type,
  supports_publishing,
  supports_replies,
  supports_comments,
  supports_threads,
  supports_video,
  supports_ingestion,
  platform_category
) VALUES
  ('linkedin', 'LinkedIn', 'https://api.linkedin.com/v2', 'oauth', true, true, true, false, true, true, 'social'),
  ('twitter', 'Twitter/X', 'https://api.twitter.com/2', 'oauth', true, true, true, true, true, true, 'social'),
  ('youtube', 'YouTube', 'https://www.googleapis.com/youtube/v3', 'oauth', true, true, true, false, true, true, 'social'),
  ('reddit', 'Reddit', 'https://oauth.reddit.com/api', 'oauth', true, true, true, true, false, true, 'social'),
  ('facebook', 'Facebook', 'https://graph.facebook.com/v18.0', 'oauth', true, true, true, false, true, true, 'social'),
  ('instagram', 'Instagram', 'https://graph.instagram.com', 'oauth', true, true, true, false, true, true, 'social'),
  ('tiktok', 'TikTok', 'https://open.tiktokapis.com/v2', 'oauth', true, true, true, false, true, true, 'social'),
  ('whatsapp', 'WhatsApp Business', 'https://graph.facebook.com/v18.0', 'oauth', true, true, false, true, false, true, 'social'),
  ('pinterest', 'Pinterest', 'https://api.pinterest.com/v5', 'oauth', true, false, true, false, false, true, 'social'),
  ('quora', 'Quora', 'https://api.quora.com', 'oauth', true, true, true, true, false, false, 'social')
ON CONFLICT (platform_key) DO NOTHING;

-- Community platforms
INSERT INTO platform_registry (
  platform_key,
  platform_label,
  api_base_url,
  auth_type,
  supports_publishing,
  supports_replies,
  supports_comments,
  supports_threads,
  supports_video,
  supports_ingestion,
  platform_category
) VALUES
  ('slack', 'Slack Communities', 'https://slack.com/api', 'oauth', false, false, true, true, false, true, 'community'),
  ('discord', 'Discord', 'https://discord.com/api/v10', 'oauth', false, false, true, true, false, true, 'community'),
  ('github', 'GitHub Discussions', 'https://api.github.com', 'oauth', true, true, true, true, false, true, 'community'),
  ('stackoverflow', 'Stack Overflow', 'https://api.stackexchange.com/2.3', 'oauth', true, true, true, true, false, true, 'community'),
  ('producthunt', 'Product Hunt', 'https://api.producthunt.com/v2', 'oauth', true, false, true, false, false, true, 'community'),
  ('hackernews', 'Hacker News', 'https://hacker-news.firebaseio.com/v0', 'oauth', false, false, true, true, false, true, 'community')
ON CONFLICT (platform_key) DO NOTHING;
