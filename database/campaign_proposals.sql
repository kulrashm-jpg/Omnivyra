-- Campaign Proposals: Auto-generated campaign plans from high-confidence opportunities.
-- When opportunity_strength > 70, the scanner creates a proposal. User can convert to campaign.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS campaign_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  proposal_title TEXT NOT NULL,
  proposal_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposal_strength NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_proposals_opportunity_id
  ON campaign_proposals(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_campaign_proposals_organization
  ON campaign_proposals(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_proposals_status
  ON campaign_proposals(status);
CREATE INDEX IF NOT EXISTS idx_campaign_proposals_created
  ON campaign_proposals(created_at DESC);

COMMENT ON TABLE campaign_proposals IS 'Auto-generated campaign proposals from high-strength opportunity_radar items; user can convert to campaign or reject';
