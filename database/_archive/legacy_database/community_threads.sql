-- =====================================================
-- COMMUNITY THREADS
-- Multi-post threads (LinkedIn carousel, Twitter thread, etc.)
-- =====================================================
-- Run after: community_posts.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS community_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  thread_type TEXT,
  thread_content TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_community_threads_post
  ON community_threads (post_id);

CREATE INDEX IF NOT EXISTS index_community_threads_type
  ON community_threads (thread_type);
