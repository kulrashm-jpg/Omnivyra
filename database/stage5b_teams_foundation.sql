-- Stage 5B: Minimal but Clean Foundation
-- 4 tables for teams, capacity, assignments, and resource projections.
-- Requires: companies(id), campaigns(id)

-- 1. teams
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_company ON teams(company_id);

-- 2. team_capacity
CREATE TABLE IF NOT EXISTS team_capacity (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  max_posts_per_week INTEGER NOT NULL,
  max_parallel_campaigns INTEGER DEFAULT 3,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. campaign_team_assignment
CREATE TABLE IF NOT EXISTS campaign_team_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  weekly_capacity_reserved INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_team_assignment_campaign ON campaign_team_assignment(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_team_assignment_team ON campaign_team_assignment(team_id);

-- 4. campaign_resource_projection
CREATE TABLE IF NOT EXISTS campaign_resource_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  total_posts INTEGER NOT NULL,
  platform_allocation JSONB NOT NULL,
  estimated_cost NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_resource_projection_campaign ON campaign_resource_projection(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_resource_projection_campaign_week
  ON campaign_resource_projection(campaign_id, week_number);
