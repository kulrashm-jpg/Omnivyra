-- =====================================================
-- HIERARCHICAL NAVIGATION SYSTEM: 12 WEEKS → WEEK → DAY
-- =====================================================
-- Clean database structure for 12-week campaign navigation

-- First, let's fix the weekly_content_refinements table
CREATE TABLE IF NOT EXISTS weekly_content_refinements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    theme VARCHAR(255) NOT NULL,
    focus_area TEXT NOT NULL,
    
    -- Content Data
    original_content JSONB NOT NULL,
    ai_enhanced_content JSONB DEFAULT '{}',
    manually_edited_content JSONB DEFAULT '{}',
    finalized_content JSONB NOT NULL,
    
    -- Status Tracking
    refinement_status VARCHAR(50) DEFAULT 'draft' CHECK (refinement_status IN ('draft', 'ai-enhanced', 'manually-edited', 'finalized', 'daily-populated')),
    ai_enhancement_applied BOOLEAN DEFAULT false,
    manual_edits_applied BOOLEAN DEFAULT false,
    finalized BOOLEAN DEFAULT false,
    daily_plan_populated BOOLEAN DEFAULT false,
    
    -- Metadata
    ai_enhancement_notes TEXT,
    manual_edit_notes TEXT,
    finalization_notes TEXT,
    enhanced_by UUID REFERENCES users(id),
    edited_by UUID REFERENCES users(id),
    finalized_by UUID REFERENCES users(id),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finalized_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE (campaign_id, week_number)
);

-- Create daily content plans table
CREATE TABLE IF NOT EXISTS daily_content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    day_of_week VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    
    -- Content Details
    platform VARCHAR(100) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    title VARCHAR(500),
    content TEXT NOT NULL,
    hashtags TEXT[],
    mentions TEXT[],
    
    -- Media & Resources
    media_urls TEXT[],
    media_types VARCHAR(20)[],
    required_resources TEXT[],
    
    -- Scheduling
    scheduled_time TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    posting_strategy TEXT,
    
    -- Status & Tracking
    status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'content-created', 'media-ready', 'scheduled', 'published', 'failed')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    
    -- Source Tracking
    source_week_content_id UUID REFERENCES content_plans(id),
    source_refinement_id UUID REFERENCES weekly_content_refinements(id),
    ai_generated BOOLEAN DEFAULT false,
    
    -- Performance Tracking
    expected_engagement INTEGER DEFAULT 0,
    target_audience TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_campaign_week ON weekly_content_refinements(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_status ON weekly_content_refinements(refinement_status);
CREATE INDEX IF NOT EXISTS idx_daily_plans_campaign_week ON daily_content_plans(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_content_plans(date);
CREATE INDEX IF NOT EXISTS idx_daily_plans_status ON daily_content_plans(status);

-- Function to get 12-week campaign overview
CREATE OR REPLACE FUNCTION get_12_week_campaign_overview(campaign_uuid UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    week_data JSONB;
BEGIN
    SELECT jsonb_build_object(
        'campaign_id', c.id,
        'campaign_name', c.name,
        'campaign_description', c.description,
        'start_date', c.start_date,
        'end_date', c.end_date,
        'status', c.status,
        'current_stage', c.current_stage,
        'weeks', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'week_number', w.week_number,
                    'theme', w.theme,
                    'focus_area', w.focus_area,
                    'refinement_status', w.refinement_status,
                    'ai_enhanced', w.ai_enhancement_applied,
                    'manually_edited', w.manual_edits_applied,
                    'finalized', w.finalized,
                    'daily_populated', w.daily_plan_populated,
                    'content_count', COALESCE(cp_count.count, 0),
                    'daily_plans_count', COALESCE(dcp_count.count, 0),
                    'week_start_date', c.start_date + INTERVAL '1 week' * (w.week_number - 1),
                    'week_end_date', c.start_date + INTERVAL '1 week' * (w.week_number - 1) + INTERVAL '6 days'
                )
            )
            FROM weekly_content_refinements w
            LEFT JOIN (
                SELECT week_number, COUNT(*) as count 
                FROM content_plans 
                WHERE campaign_id = campaign_uuid 
                GROUP BY week_number
            ) cp_count ON w.week_number = cp_count.week_number
            LEFT JOIN (
                SELECT week_number, COUNT(*) as count 
                FROM daily_content_plans 
                WHERE campaign_id = campaign_uuid 
                GROUP BY week_number
            ) dcp_count ON w.week_number = dcp_count.week_number
            WHERE w.campaign_id = campaign_uuid
            ORDER BY w.week_number
        )
    ) INTO result
    FROM campaigns c
    WHERE c.id = campaign_uuid;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Function to get week detail view
CREATE OR REPLACE FUNCTION get_week_detail_view(campaign_uuid UUID, week_num INTEGER)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    day_data JSONB;
BEGIN
    SELECT jsonb_build_object(
        'campaign_id', c.id,
        'campaign_name', c.name,
        'week_number', week_num,
        'theme', wcr.theme,
        'focus_area', wcr.focus_area,
        'refinement_status', wcr.refinement_status,
        'ai_enhanced', wcr.ai_enhancement_applied,
        'manually_edited', wcr.manual_edits_applied,
        'finalized', wcr.finalized,
        'daily_populated', wcr.daily_plan_populated,
        'week_start_date', c.start_date + INTERVAL '1 week' * (week_num - 1),
        'week_end_date', c.start_date + INTERVAL '1 week' * (week_num - 1) + INTERVAL '6 days',
        'days', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'day_of_week', dcp.day_of_week,
                    'date', dcp.date,
                    'content_count', COUNT(dcp.id),
                    'platforms', array_agg(DISTINCT dcp.platform),
                    'content_types', array_agg(DISTINCT dcp.content_type),
                    'status_summary', jsonb_build_object(
                        'planned', COUNT(CASE WHEN dcp.status = 'planned' THEN 1 END),
                        'content_created', COUNT(CASE WHEN dcp.status = 'content-created' THEN 1 END),
                        'media_ready', COUNT(CASE WHEN dcp.status = 'media-ready' THEN 1 END),
                        'scheduled', COUNT(CASE WHEN dcp.status = 'scheduled' THEN 1 END),
                        'published', COUNT(CASE WHEN dcp.status = 'published' THEN 1 END)
                    )
                )
            )
            FROM daily_content_plans dcp
            WHERE dcp.campaign_id = campaign_uuid AND dcp.week_number = week_num
            GROUP BY dcp.day_of_week, dcp.date
            ORDER BY dcp.date
        ),
        'total_content_items', (
            SELECT COUNT(*) FROM content_plans 
            WHERE campaign_id = campaign_uuid AND week_number = week_num
        ),
        'total_daily_plans', (
            SELECT COUNT(*) FROM daily_content_plans 
            WHERE campaign_id = campaign_uuid AND week_number = week_num
        )
    ) INTO result
    FROM campaigns c
    LEFT JOIN weekly_content_refinements wcr ON c.id = wcr.campaign_id AND wcr.week_number = week_num
    WHERE c.id = campaign_uuid;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Function to get day detail view
CREATE OR REPLACE FUNCTION get_day_detail_view(campaign_uuid UUID, week_num INTEGER, day_name VARCHAR(20))
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    content_item JSONB;
BEGIN
    SELECT jsonb_build_object(
        'campaign_id', c.id,
        'campaign_name', c.name,
        'week_number', week_num,
        'day_of_week', day_name,
        'date', dcp.date,
        'theme', wcr.theme,
        'focus_area', wcr.focus_area,
        'content_items', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', dcp.id,
                    'platform', dcp.platform,
                    'content_type', dcp.content_type,
                    'title', dcp.title,
                    'content', dcp.content,
                    'hashtags', dcp.hashtags,
                    'mentions', dcp.mentions,
                    'scheduled_time', dcp.scheduled_time,
                    'status', dcp.status,
                    'priority', dcp.priority,
                    'media_urls', dcp.media_urls,
                    'required_resources', dcp.required_resources,
                    'posting_strategy', dcp.posting_strategy,
                    'expected_engagement', dcp.expected_engagement,
                    'target_audience', dcp.target_audience,
                    'ai_generated', dcp.ai_generated,
                    'created_at', dcp.created_at,
                    'updated_at', dcp.updated_at
                )
            )
            FROM daily_content_plans dcp
            WHERE dcp.campaign_id = campaign_uuid 
            AND dcp.week_number = week_num 
            AND dcp.day_of_week = day_name
            ORDER BY dcp.scheduled_time, dcp.created_at
        ),
        'total_items', (
            SELECT COUNT(*) FROM daily_content_plans 
            WHERE campaign_id = campaign_uuid 
            AND week_number = week_num 
            AND day_of_week = day_name
        ),
        'status_summary', (
            SELECT jsonb_build_object(
                'planned', COUNT(CASE WHEN status = 'planned' THEN 1 END),
                'content_created', COUNT(CASE WHEN status = 'content-created' THEN 1 END),
                'media_ready', COUNT(CASE WHEN status = 'media-ready' THEN 1 END),
                'scheduled', COUNT(CASE WHEN status = 'scheduled' THEN 1 END),
                'published', COUNT(CASE WHEN status = 'published' THEN 1 END)
            )
            FROM daily_content_plans 
            WHERE campaign_id = campaign_uuid 
            AND week_number = week_num 
            AND day_of_week = day_name
        ),
        'platforms', (
            SELECT array_agg(DISTINCT platform) 
            FROM daily_content_plans 
            WHERE campaign_id = campaign_uuid 
            AND week_number = week_num 
            AND day_of_week = day_name
        ),
        'content_types', (
            SELECT array_agg(DISTINCT content_type) 
            FROM daily_content_plans 
            WHERE campaign_id = campaign_uuid 
            AND week_number = week_num 
            AND day_of_week = day_name
        )
    ) INTO result
    FROM campaigns c
    LEFT JOIN weekly_content_refinements wcr ON c.id = wcr.campaign_id AND wcr.week_number = week_num
    LEFT JOIN daily_content_plans dcp ON c.id = dcp.campaign_id AND dcp.week_number = week_num AND dcp.day_of_week = day_name
    WHERE c.id = campaign_uuid
    LIMIT 1;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Create view for navigation breadcrumbs
CREATE OR REPLACE VIEW navigation_breadcrumbs AS
SELECT 
    c.id as campaign_id,
    c.name as campaign_name,
    wcr.week_number,
    wcr.theme,
    dcp.day_of_week,
    dcp.date,
    jsonb_build_object(
        'campaign', jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'url', '/campaign-planning?campaignId=' || c.id
        ),
        'week', jsonb_build_object(
            'number', wcr.week_number,
            'theme', wcr.theme,
            'url', '/campaign-planning/week?campaignId=' || c.id || '&week=' || wcr.week_number
        ),
        'day', jsonb_build_object(
            'name', dcp.day_of_week,
            'date', dcp.date,
            'url', '/campaign-planning/day?campaignId=' || c.id || '&week=' || wcr.week_number || '&day=' || dcp.day_of_week
        )
    ) as breadcrumbs
FROM campaigns c
LEFT JOIN weekly_content_refinements wcr ON c.id = wcr.campaign_id
LEFT JOIN daily_content_plans dcp ON c.id = dcp.campaign_id AND wcr.week_number = dcp.week_number;

-- Success message
SELECT 'Hierarchical navigation system created successfully! 12 Weeks → Week → Day flow ready.' as message;
