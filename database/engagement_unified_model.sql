-- =====================================================
-- PHASE 1: UNIFIED ENGAGEMENT DATA MODEL
-- Extends existing system without breaking post_comments pipeline.
-- Run after: step10-comment-engagement.sql
-- =====================================================

-- engagement_sources: platform metadata
CREATE TABLE IF NOT EXISTS engagement_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'api',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_sources_platform
  ON engagement_sources(platform);

-- engagement_authors: normalized author table
CREATE TABLE IF NOT EXISTS engagement_authors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  profile_url TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_authors_platform_user
  ON engagement_authors(platform, platform_user_id);

CREATE INDEX IF NOT EXISTS idx_engagement_authors_platform
  ON engagement_authors(platform);

-- engagement_threads: conversation thread container
CREATE TABLE IF NOT EXISTS engagement_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  platform_thread_id TEXT NOT NULL,
  root_message_id UUID,
  source_id UUID REFERENCES engagement_sources(id) ON DELETE SET NULL,
  organization_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_threads_platform_thread
  ON engagement_threads(platform_thread_id);

CREATE INDEX IF NOT EXISTS idx_engagement_threads_source
  ON engagement_threads(source_id);

CREATE INDEX IF NOT EXISTS idx_engagement_threads_organization
  ON engagement_threads(organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_threads_platform_thread_org
  ON engagement_threads(platform, platform_thread_id, organization_id)
  WHERE organization_id IS NOT NULL;

-- engagement_messages: unified engagement messages
CREATE TABLE IF NOT EXISTS engagement_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  source_id UUID REFERENCES engagement_sources(id) ON DELETE SET NULL,
  author_id UUID REFERENCES engagement_authors(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  platform_message_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'comment',
  parent_message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL,
  content TEXT,
  raw_payload JSONB,
  like_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  sentiment_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  platform_created_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_messages_platform_thread
  ON engagement_messages(thread_id, platform_message_id);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_platform_message_id
  ON engagement_messages(platform_message_id);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_thread
  ON engagement_messages(thread_id);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_thread_created
  ON engagement_messages(thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_author
  ON engagement_messages(author_id);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_platform_created
  ON engagement_messages(platform_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_platform
  ON engagement_messages(platform);

-- Link to post_comments for traceability (optional, non-blocking)
ALTER TABLE engagement_messages
  ADD COLUMN IF NOT EXISTS post_comment_id UUID REFERENCES post_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_messages_post_comment
  ON engagement_messages(post_comment_id)
  WHERE post_comment_id IS NOT NULL;

-- Seed engagement_sources for supported platforms
INSERT INTO engagement_sources (platform, source_type)
VALUES
  ('linkedin', 'api'),
  ('twitter', 'api'),
  ('instagram', 'api'),
  ('facebook', 'api'),
  ('youtube', 'api'),
  ('reddit', 'api')
ON CONFLICT (platform) DO NOTHING;
