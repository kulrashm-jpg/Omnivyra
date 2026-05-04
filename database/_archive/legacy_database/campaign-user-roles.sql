-- =====================================================
-- CAMPAIGN USER ROLES (Additive — Level 2 / campaign-scoped)
-- =====================================================
-- Do NOT modify existing tables.
-- One row per (user, campaign) = one campaign-level role.
-- Role values: e.g. CAMPAIGN_OPERATOR, CONTENT_CREATOR (campaign-scoped).
-- =====================================================

CREATE TABLE IF NOT EXISTS campaign_user_roles (
  user_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT campaign_user_roles_unique_user_campaign UNIQUE (user_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_user_roles_user
  ON campaign_user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_user_roles_campaign
  ON campaign_user_roles(campaign_id);

COMMENT ON TABLE campaign_user_roles IS 'Campaign-scoped roles (Level 2). Company roles remain in user_company_roles.';
