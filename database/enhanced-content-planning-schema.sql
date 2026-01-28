-- ENHANCED CONTENT PLANNING SCHEMA
-- Designed to capture comprehensive 12-week content marketing plans
-- Based on detailed planning requirements like Drishiq Music Promotion example

-- ==============================================
-- ENHANCED CAMPAIGN PLANNING TABLES
-- ==============================================

-- Campaign Strategy Overview
CREATE TABLE campaign_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    
    -- Campaign Overview
    objective TEXT NOT NULL,
    target_audience TEXT NOT NULL,
    key_platforms TEXT[] NOT NULL,
    campaign_phases JSONB, -- Phase definitions (Foundation, Growth, etc.)
    
    -- Content Strategy
    content_pillars JSONB NOT NULL, -- Array of content pillar objects
    content_frequency JSONB NOT NULL, -- Platform-specific posting frequency
    visual_identity JSONB, -- Brand colors, fonts, templates
    voice_tone TEXT,
    
    -- Success Metrics
    overall_goals JSONB NOT NULL, -- Total impressions, engagements, etc.
    weekly_kpis JSONB NOT NULL, -- Weekly tracking metrics
    
    -- Implementation Guidelines
    hashtag_strategy JSONB, -- Branded, industry, trending hashtags
    posting_guidelines TEXT,
    ai_enhancement_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Weekly Content Plans (Enhanced)
CREATE TABLE weekly_content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL CHECK (week_number >= 1 AND week_number <= 12),
    
    -- Week Overview
    phase VARCHAR(100), -- Foundation, Growth, Consolidation, Sustain
    theme VARCHAR(255) NOT NULL,
    focus_area TEXT NOT NULL,
    key_messaging TEXT,
    
    -- Content Strategy
    content_types TEXT[] NOT NULL, -- Array of content types for the week
    platform_strategy JSONB NOT NULL, -- Platform-specific strategy
    call_to_action TEXT,
    
    -- Success Metrics
    target_metrics JSONB NOT NULL, -- Impressions, engagements, conversions
    key_performance_indicators JSONB,
    
    -- Implementation
    content_guidelines TEXT,
    hashtag_suggestions TEXT[],
    visual_requirements JSONB,
    
    -- Status Tracking
    status VARCHAR(50) DEFAULT 'planned', -- planned, in_progress, completed
    completion_percentage INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(campaign_id, week_number)
);

-- Daily Content Plans (Enhanced)
CREATE TABLE daily_content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL CHECK (week_number >= 1 AND week_number <= 12),
    day_of_week VARCHAR(20) NOT NULL, -- Monday, Tuesday, etc.
    date DATE NOT NULL,
    
    -- Content Details
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    title VARCHAR(500),
    content TEXT NOT NULL,
    description TEXT,
    
    -- Media & Visuals
    media_requirements JSONB, -- Image/video specifications
    visual_elements JSONB, -- Colors, fonts, layout requirements
    media_urls TEXT[],
    
    -- Engagement Strategy
    hashtags TEXT[],
    call_to_action TEXT,
    engagement_strategy TEXT,
    
    -- Scheduling
    optimal_posting_time TIME,
    posting_strategy TEXT,
    
    -- Performance Tracking
    target_metrics JSONB, -- Expected impressions, engagements
    actual_metrics JSONB, -- Actual performance data
    
    -- Status
    status VARCHAR(50) DEFAULT 'planned', -- planned, scheduled, published, completed
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high
    ai_generated BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content Pillars Management
CREATE TABLE content_pillars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    
    pillar_name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    percentage_allocation INTEGER NOT NULL CHECK (percentage_allocation >= 0 AND percentage_allocation <= 100),
    content_types TEXT[] NOT NULL,
    platform_preferences TEXT[],
    hashtag_categories TEXT[],
    visual_style JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Platform Strategy Configuration
CREATE TABLE platform_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    
    -- Platform-Specific Strategy
    content_frequency JSONB NOT NULL, -- Posts per week, stories per week, etc.
    optimal_posting_times JSONB, -- Best times for each day
    content_types TEXT[] NOT NULL, -- Supported content types
    character_limits JSONB, -- Platform-specific limits
    media_requirements JSONB, -- Image/video specs
    
    -- Engagement Strategy
    hashtag_limit INTEGER,
    engagement_tactics TEXT[],
    community_management TEXT,
    
    -- Performance Goals
    target_metrics JSONB NOT NULL, -- Platform-specific goals
    success_criteria TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(campaign_id, platform)
);

-- Campaign Performance Tracking
CREATE TABLE campaign_performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER CHECK (week_number >= 1 AND week_number <= 12),
    platform VARCHAR(50),
    date DATE NOT NULL,
    
    -- Reach Metrics
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    followers_gained INTEGER DEFAULT 0,
    
    -- Engagement Metrics
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    
    -- Conversion Metrics
    conversions INTEGER DEFAULT 0,
    newsletter_signups INTEGER DEFAULT 0,
    website_traffic INTEGER DEFAULT 0,
    
    -- Calculated Metrics
    engagement_rate DECIMAL(5,2),
    click_through_rate DECIMAL(5,2),
    conversion_rate DECIMAL(5,2),
    
    -- UGC Metrics
    ugc_submissions INTEGER DEFAULT 0,
    playlist_adds INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI Enhancement Tracking
CREATE TABLE ai_enhancement_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER,
    day_id UUID REFERENCES daily_content_plans(id),
    
    enhancement_type VARCHAR(100) NOT NULL, -- content_optimization, hashtag_suggestions, etc.
    original_content TEXT,
    enhanced_content TEXT,
    ai_provider VARCHAR(50), -- gpt-4, claude, demo
    confidence_score DECIMAL(3,2),
    improvement_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content Templates for Reusability
CREATE TABLE content_templates_enhanced (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    template_name VARCHAR(255) NOT NULL,
    template_type VARCHAR(100) NOT NULL, -- post_template, story_template, etc.
    platform VARCHAR(50) NOT NULL,
    
    -- Template Content
    title_template TEXT,
    content_template TEXT NOT NULL,
    hashtag_template TEXT[],
    call_to_action_template TEXT,
    
    -- Media Templates
    media_requirements JSONB,
    visual_style JSONB,
    
    -- Variables
    variables JSONB, -- {brand_name}, {product_name}, etc.
    usage_instructions TEXT,
    
    -- Metadata
    tags TEXT[],
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- INDEXES FOR PERFORMANCE
-- ==============================================

CREATE INDEX idx_campaign_strategies_campaign ON campaign_strategies(campaign_id);
CREATE INDEX idx_weekly_plans_campaign_week ON weekly_content_plans(campaign_id, week_number);
CREATE INDEX idx_daily_plans_campaign_date ON daily_content_plans(campaign_id, date);
CREATE INDEX idx_daily_plans_week_day ON daily_content_plans(week_number, day_of_week);
CREATE INDEX idx_content_pillars_campaign ON content_pillars(campaign_id);
CREATE INDEX idx_platform_strategies_campaign ON platform_strategies(campaign_id, platform);
CREATE INDEX idx_performance_metrics_campaign ON campaign_performance_metrics(campaign_id, date);
CREATE INDEX idx_performance_metrics_week ON campaign_performance_metrics(campaign_id, week_number);
CREATE INDEX idx_ai_enhancement_campaign ON ai_enhancement_logs(campaign_id);

-- ==============================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ==============================================

-- Update campaign completion percentage based on weekly plans
CREATE OR REPLACE FUNCTION update_campaign_completion()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE campaigns 
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.campaign_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_campaign_completion
    AFTER INSERT OR UPDATE ON weekly_content_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_campaign_completion();

-- ==============================================
-- SAMPLE DATA STRUCTURE EXAMPLES
-- ==============================================

-- Example content pillars structure:
-- [
--   {
--     "name": "Music Showcases",
--     "percentage": 40,
--     "content_types": ["post", "video", "story"],
--     "platforms": ["instagram", "tiktok", "youtube"]
--   },
--   {
--     "name": "Behind-the-Scenes",
--     "percentage": 25,
--     "content_types": ["story", "video", "post"],
--     "platforms": ["instagram", "youtube"]
--   }
-- ]

-- Example platform frequency structure:
-- {
--   "instagram": {
--     "posts": 4,
--     "stories": 7,
--     "reels": 3
--   },
--   "tiktok": {
--     "videos": 6
--   }
-- }

-- Example target metrics structure:
-- {
--   "impressions": 75000,
--   "engagements": 5000,
--   "followers_gained": 2000,
--   "ugc_submissions": 200,
--   "playlist_adds": 1000
-- }



