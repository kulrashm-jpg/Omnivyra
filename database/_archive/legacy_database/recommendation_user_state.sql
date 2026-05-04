-- =====================================================
-- RECOMMENDATION USER STATE
-- User/org-level state for recommendations: ACTIVE, ARCHIVED, LONG_TERM
-- =====================================================
-- Run after: recommendation_snapshots, companies
-- =====================================================

CREATE TABLE IF NOT EXISTS recommendation_user_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NULL,
  recommendation_id UUID NOT NULL REFERENCES recommendation_snapshots(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'ARCHIVED', 'LONG_TERM')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, recommendation_id)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_user_state_org_state
  ON recommendation_user_state(organization_id, state);
