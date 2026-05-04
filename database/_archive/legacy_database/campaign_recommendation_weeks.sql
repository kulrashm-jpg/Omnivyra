-- Campaign Recommendation Weeks
-- Stores stage-aware recommendations per week, aligned with twelve_week_plan / weekly_content_refinements.
-- User vets/refines via AI chat; once agreed, merge into weekly plans (individual week or combined).
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS campaign_recommendation_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  -- Session/batch: groups recommendations from one consultation run (generated on create)
  session_id UUID NOT NULL,
  -- Status: pending (being vetted), agreed (user confirmed), applied (merged into plan)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'agreed', 'applied')),

  -- Content improvements (aligned with CampaignBlueprintWeek / week_extras)
  topics_to_cover TEXT[],
  primary_objective TEXT,
  summary TEXT,
  objectives TEXT[],
  goals TEXT[],

  -- Scheduling suggestions
  suggested_days_to_post TEXT[],
  suggested_best_times JSONB,
  suggested_cadence JSONB,

  -- Platform × content type matrix (aligned with platform_content_breakdown)
  platform_allocation JSONB,
  platform_content_breakdown JSONB,
  content_type_mix TEXT[],

  -- AI chat refinement notes (what changed during vetting)
  refinement_notes TEXT,
  agreed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (campaign_id, week_number, session_id)
);

-- Multiple sessions per campaign; session_id groups one consultation run
CREATE INDEX IF NOT EXISTS idx_campaign_recommendation_weeks_campaign
  ON campaign_recommendation_weeks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recommendation_weeks_campaign_week
  ON campaign_recommendation_weeks(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_campaign_recommendation_weeks_status
  ON campaign_recommendation_weeks(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recommendation_weeks_session
  ON campaign_recommendation_weeks(campaign_id, session_id);

COMMENT ON TABLE campaign_recommendation_weeks IS 'Stage-aware recommendations per week; vet via AI chat, then merge into twelve_week_plan / weekly_content_refinements when agreed';
