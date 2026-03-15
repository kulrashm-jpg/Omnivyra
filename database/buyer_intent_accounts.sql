-- =====================================================
-- BUYER INTENT ACCOUNTS
-- High-intent participants from engagement_opportunities
-- Run after: engagement_opportunities, engagement_authors
-- =====================================================

CREATE TABLE IF NOT EXISTS buyer_intent_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT,
  platform TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  intent_signals INTEGER NOT NULL DEFAULT 0,
  recommendation_requests INTEGER NOT NULL DEFAULT 0,
  comparison_mentions INTEGER NOT NULL DEFAULT 0,
  intent_score NUMERIC NOT NULL DEFAULT 0,
  last_detected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buyer_intent_accounts_organization
  ON buyer_intent_accounts(organization_id);

CREATE INDEX IF NOT EXISTS idx_buyer_intent_accounts_intent_score
  ON buyer_intent_accounts(intent_score DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_intent_accounts_org_author_platform
  ON buyer_intent_accounts(organization_id, author_id, platform);
