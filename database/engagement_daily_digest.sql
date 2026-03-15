-- =====================================================
-- ENGAGEMENT DAILY DIGEST
-- AI Daily Engagement Digest: daily summary per organization.
-- Run after: engagement_unified_model.sql, engagement_lead_signals.sql, engagement_opportunities.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_daily_digest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  new_threads INTEGER NOT NULL DEFAULT 0,
  high_priority_threads INTEGER NOT NULL DEFAULT 0,
  lead_signals INTEGER NOT NULL DEFAULT 0,
  opportunity_signals INTEGER NOT NULL DEFAULT 0,
  recommended_thread_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS idx_digest_org_date;
CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_org_date
  ON engagement_daily_digest (organization_id, digest_date DESC);
