-- Analytics Ingestion Schema Migration
-- Extends platform_metrics_snapshots for per-post and growth analytics ingestion pipeline.
-- Run this migration once; uses IF NOT EXISTS / IF EXISTS guards throughout.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend platform_metrics_snapshots
--    Add social_account_id, growth fields, raw payload, daily unique index.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_metrics_snapshots
  ADD COLUMN IF NOT EXISTS social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS impressions        BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach              BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS follower_gain      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_metrics        JSONB DEFAULT '{}',
  -- Dedicated date column avoids functional-index IMMUTABLE requirement on timestamptz::date
  ADD COLUMN IF NOT EXISTS captured_date      DATE;

-- Backfill captured_date from existing rows (safe to run multiple times)
UPDATE platform_metrics_snapshots
  SET captured_date = (captured_at AT TIME ZONE 'UTC')::date
  WHERE captured_date IS NULL;

-- Deduplicate existing rows before creating unique index.
-- Keep the row with the latest captured_at per (company_id, platform, captured_date).
DELETE FROM platform_metrics_snapshots
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY company_id, platform, captured_date
        ORDER BY captured_at DESC
      ) AS rn
    FROM platform_metrics_snapshots
    WHERE captured_date IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Prevent duplicate snapshots on the same calendar date per company+platform.
-- Uses plain column — no IMMUTABLE issue.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_platform_metrics_company_platform_day
  ON platform_metrics_snapshots (company_id, platform, captured_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ensure content_analytics has analytics_date (production schema uses this
--    column; step5 created 'date' instead — add alias if both exist)
-- ─────────────────────────────────────────────────────────────────────────────

-- Add analytics_date if the column is missing (some envs only have 'date')
ALTER TABLE content_analytics
  ADD COLUMN IF NOT EXISTS analytics_date DATE,
  ADD COLUMN IF NOT EXISTS user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform_metrics JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT now();

-- Backfill analytics_date from date where analytics_date is null
UPDATE content_analytics SET analytics_date = date WHERE analytics_date IS NULL AND date IS NOT NULL;

-- Unique index for upsert on conflict (scheduled_post_id, analytics_date)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_content_analytics_post_date
  ON content_analytics (scheduled_post_id, analytics_date)
  WHERE analytics_date IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. post_analytics_polls — tracks scheduled polling jobs per published post
--    Enables the 15-min and 24-h delayed metric refresh after publish.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS post_analytics_polls (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform          TEXT NOT NULL,
  platform_post_id  TEXT NOT NULL,
  company_id        UUID NOT NULL,
  user_id           UUID,
  poll_after        TIMESTAMPTZ NOT NULL,      -- earliest time to execute this poll
  attempts          INTEGER DEFAULT 0,
  last_polled_at    TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
  created_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_poll_status CHECK (status IN ('pending', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_post_analytics_polls_pending
  ON post_analytics_polls (poll_after)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_post_analytics_polls_account
  ON post_analytics_polls (social_account_id, platform_post_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Summary
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 'analytics-ingestion-schema migration complete' AS message;
