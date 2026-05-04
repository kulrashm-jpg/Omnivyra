-- =====================================================
-- CAMPAIGN SUMMARY & WEEKLY PERFORMANCE ENHANCEMENT
-- =====================================================
-- Add columns to existing tables for campaign summaries and weekly tracking
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. ENHANCE CAMPAIGNS TABLE - Add campaign summary fields
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_audience TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_focus TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_metrics JSONB DEFAULT '{"reach": 0, "engagement": 0, "conversions": 0}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_summary JSONB DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ai_generated_summary TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS weekly_themes JSONB DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS performance_targets JSONB DEFAULT '{}';

-- 2. ENHANCE CAMPAIGN_PERFORMANCE TABLE - Add weekly tracking
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS week_number INTEGER;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS week_start_date DATE;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS week_end_date DATE;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS target_reach INTEGER DEFAULT 0;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS target_engagement DECIMAL(10,2) DEFAULT 0;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS target_conversions INTEGER DEFAULT 0;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS actual_vs_target JSONB DEFAULT '{}';
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS content_types_performance JSONB DEFAULT '{}';
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS weekly_theme TEXT;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS weekly_focus_area TEXT;
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS platform VARCHAR(100);
ALTER TABLE campaign_performance ADD COLUMN IF NOT EXISTS content_type VARCHAR(100);

-- 3. ENHANCE CAMPAIGN_GOALS TABLE - Add target tracking
ALTER TABLE campaign_goals ADD COLUMN IF NOT EXISTS target_numbers JSONB DEFAULT '{"reach": 0, "engagement": 0, "conversions": 0}';
ALTER TABLE campaign_goals ADD COLUMN IF NOT EXISTS weekly_targets JSONB DEFAULT '{}';
ALTER TABLE campaign_goals ADD COLUMN IF NOT EXISTS performance_tracking BOOLEAN DEFAULT true;
ALTER TABLE campaign_goals ADD COLUMN IF NOT EXISTS actual_performance JSONB DEFAULT '{}';

-- 4. ENHANCE CONTENT_PLANS TABLE - Add weekly context
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS week_number INTEGER;
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS weekly_theme TEXT;
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS focus_area TEXT;
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS alignment_status VARCHAR(50) DEFAULT 'draft';
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS refinement_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS ai_suggestions JSONB DEFAULT '[]';
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS manual_edits JSONB DEFAULT '{}';

-- 5. ENHANCE AI_THREADS TABLE - Add planning context
ALTER TABLE ai_threads ADD COLUMN IF NOT EXISTS thread_type VARCHAR(50) DEFAULT 'general';
ALTER TABLE ai_threads ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
ALTER TABLE ai_threads ADD COLUMN IF NOT EXISTS plan_review_data JSONB DEFAULT '{}';
ALTER TABLE ai_threads ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'pending';

-- 6. CREATE NEW TABLE FOR WEEKLY CONTENT REFINEMENTS
CREATE TABLE IF NOT EXISTS weekly_content_refinements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    theme TEXT,
    focus_area TEXT,
    ai_suggestions JSONB DEFAULT '[]',
    manual_edits JSONB DEFAULT '{}',
    refinement_status VARCHAR(50) DEFAULT 'pending' CHECK (refinement_status IN ('pending', 'ai_enhanced', 'manually_edited', 'finalized')),
    finalized_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(campaign_id, week_number)
);

-- 7. CREATE NEW TABLE FOR DAILY CONTENT PLANS
CREATE TABLE IF NOT EXISTS daily_content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    weekly_refinement_id UUID REFERENCES weekly_content_refinements(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    day_of_week VARCHAR(20),
    platform VARCHAR(100) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    title TEXT,
    description TEXT,
    content TEXT,
    hashtags TEXT[],
    status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'created', 'reviewed', 'scheduled', 'published', 'failed')),
    ai_generated BOOLEAN DEFAULT false,
    performance_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_campaign_performance_week ON campaign_performance(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_campaign_performance_date ON campaign_performance(performance_date);
CREATE INDEX IF NOT EXISTS idx_content_plans_week ON content_plans(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_campaign ON weekly_content_refinements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_campaign ON daily_content_plans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_content_plans(date);

-- 9. ADD COMMENTS FOR DOCUMENTATION
COMMENT ON COLUMN campaigns.objective IS 'Main campaign objective and goals';
COMMENT ON COLUMN campaigns.target_audience IS 'Primary target audience description';
COMMENT ON COLUMN campaigns.content_focus IS 'Main content focus and strategy';
COMMENT ON COLUMN campaigns.target_metrics IS 'Target metrics for reach, engagement, conversions';
COMMENT ON COLUMN campaigns.campaign_summary IS 'Comprehensive campaign summary data';
COMMENT ON COLUMN campaigns.ai_generated_summary IS 'AI-generated campaign summary';
COMMENT ON COLUMN campaigns.weekly_themes IS 'Array of weekly themes for 12-week plan';
COMMENT ON COLUMN campaigns.performance_targets IS 'Performance targets and KPIs';

COMMENT ON COLUMN campaign_performance.week_number IS 'Week number in 12-week campaign (1-12)';
COMMENT ON COLUMN campaign_performance.week_start_date IS 'Start date of the week';
COMMENT ON COLUMN campaign_performance.week_end_date IS 'End date of the week';
COMMENT ON COLUMN campaign_performance.target_reach IS 'Target reach for the week';
COMMENT ON COLUMN campaign_performance.target_engagement IS 'Target engagement for the week';
COMMENT ON COLUMN campaign_performance.target_conversions IS 'Target conversions for the week';
COMMENT ON COLUMN campaign_performance.actual_vs_target IS 'Comparison of actual vs target performance';
COMMENT ON COLUMN campaign_performance.content_types_performance IS 'Performance breakdown by content type';
COMMENT ON COLUMN campaign_performance.weekly_theme IS 'Theme for the week';
COMMENT ON COLUMN campaign_performance.weekly_focus_area IS 'Focus area for the week';

COMMENT ON TABLE weekly_content_refinements IS 'Weekly content refinement and planning data';
COMMENT ON TABLE daily_content_plans IS 'Daily content plans generated from weekly refinements';

-- 10. VERIFY CHANGES
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name IN ('campaigns', 'campaign_performance', 'campaign_goals', 'content_plans', 'ai_threads', 'weekly_content_refinements', 'daily_content_plans')
ORDER BY table_name, ordinal_position;
