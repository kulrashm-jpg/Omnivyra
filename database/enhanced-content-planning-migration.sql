-- ENHANCED CONTENT PLANNING SCHEMA - MIGRATION SCRIPT
-- This script handles existing tables and adds new columns/tables safely
-- Run this instead of the full schema if tables already exist

-- ==============================================
-- CHECK AND CREATE MISSING TABLES SAFELY
-- ==============================================

-- Create campaign_strategies table if it doesn't exist
CREATE TABLE IF NOT EXISTS campaign_strategies (
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

-- Create content_pillars table if it doesn't exist
CREATE TABLE IF NOT EXISTS content_pillars (
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

-- Create platform_strategies table if it doesn't exist
CREATE TABLE IF NOT EXISTS platform_strategies (
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

-- Create campaign_performance_metrics table if it doesn't exist
CREATE TABLE IF NOT EXISTS campaign_performance_metrics (
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

-- Create ai_enhancement_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS ai_enhancement_logs (
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

-- Create content_templates_enhanced table if it doesn't exist
CREATE TABLE IF NOT EXISTS content_templates_enhanced (
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
-- ENHANCE EXISTING TABLES
-- ==============================================

-- Add missing columns to campaigns table if they don't exist
DO $$ 
BEGIN
    -- Add weekly_themes column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'campaigns' AND column_name = 'weekly_themes') THEN
        ALTER TABLE campaigns ADD COLUMN weekly_themes JSONB;
    END IF;
    
    -- Add ai_generated_summary column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'campaigns' AND column_name = 'ai_generated_summary') THEN
        ALTER TABLE campaigns ADD COLUMN ai_generated_summary TEXT;
    END IF;
    
    -- Add current_stage column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'campaigns' AND column_name = 'current_stage') THEN
        ALTER TABLE campaigns ADD COLUMN current_stage VARCHAR(50) DEFAULT 'planning';
    END IF;
    
    -- Add thread_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'campaigns' AND column_name = 'thread_id') THEN
        ALTER TABLE campaigns ADD COLUMN thread_id VARCHAR(255);
    END IF;
END $$;

-- Enhance weekly_content_refinements table if it exists
DO $$
BEGIN
    -- Add missing columns to weekly_content_refinements if they don't exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'weekly_content_refinements') THEN
        
        -- Add phase column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'phase') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN phase VARCHAR(100);
        END IF;
        
        -- Add key_messaging column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'key_messaging') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN key_messaging TEXT;
        END IF;
        
        -- Add content_types column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'content_types') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN content_types TEXT[];
        END IF;
        
        -- Add platform_strategy column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'platform_strategy') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN platform_strategy JSONB;
        END IF;
        
        -- Add call_to_action column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'call_to_action') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN call_to_action TEXT;
        END IF;
        
        -- Add target_metrics column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'target_metrics') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN target_metrics JSONB;
        END IF;
        
        -- Add content_guidelines column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'content_guidelines') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN content_guidelines TEXT;
        END IF;
        
        -- Add hashtag_suggestions column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'hashtag_suggestions') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN hashtag_suggestions TEXT[];
        END IF;
        
        -- Add completion_percentage column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'weekly_content_refinements' AND column_name = 'completion_percentage') THEN
            ALTER TABLE weekly_content_refinements ADD COLUMN completion_percentage INTEGER DEFAULT 0;
        END IF;
    END IF;
END $$;

-- Enhance daily_content_plans table if it exists
DO $$
BEGIN
    -- Add missing columns to daily_content_plans if they don't exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_content_plans') THEN
        
        -- Add media_requirements column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'media_requirements') THEN
            ALTER TABLE daily_content_plans ADD COLUMN media_requirements JSONB;
        END IF;
        
        -- Add visual_elements column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'visual_elements') THEN
            ALTER TABLE daily_content_plans ADD COLUMN visual_elements JSONB;
        END IF;
        
        -- Add media_urls column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'media_urls') THEN
            ALTER TABLE daily_content_plans ADD COLUMN media_urls TEXT[];
        END IF;
        
        -- Add engagement_strategy column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'engagement_strategy') THEN
            ALTER TABLE daily_content_plans ADD COLUMN engagement_strategy TEXT;
        END IF;
        
        -- Add posting_strategy column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'posting_strategy') THEN
            ALTER TABLE daily_content_plans ADD COLUMN posting_strategy TEXT;
        END IF;
        
        -- Add target_metrics column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'target_metrics') THEN
            ALTER TABLE daily_content_plans ADD COLUMN target_metrics JSONB;
        END IF;
        
        -- Add actual_metrics column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'actual_metrics') THEN
            ALTER TABLE daily_content_plans ADD COLUMN actual_metrics JSONB;
        END IF;
        
        -- Add ai_generated column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'daily_content_plans' AND column_name = 'ai_generated') THEN
            ALTER TABLE daily_content_plans ADD COLUMN ai_generated BOOLEAN DEFAULT FALSE;
        END IF;
    END IF;
END $$;

-- ==============================================
-- CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_campaign_strategies_campaign ON campaign_strategies(campaign_id);
CREATE INDEX IF NOT EXISTS idx_content_pillars_campaign ON content_pillars(campaign_id);
CREATE INDEX IF NOT EXISTS idx_platform_strategies_campaign ON platform_strategies(campaign_id, platform);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_campaign ON campaign_performance_metrics(campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_week ON campaign_performance_metrics(campaign_id, week_number);
CREATE INDEX IF NOT EXISTS idx_ai_enhancement_campaign ON ai_enhancement_logs(campaign_id);

-- ==============================================
-- CREATE TRIGGERS FOR AUTOMATIC UPDATES
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

-- Create trigger if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_campaign_completion') THEN
        CREATE TRIGGER trigger_update_campaign_completion
            AFTER INSERT OR UPDATE ON weekly_content_refinements
            FOR EACH ROW
            EXECUTE FUNCTION update_campaign_completion();
    END IF;
END $$;

-- ==============================================
-- VERIFICATION QUERIES
-- ==============================================

-- Check which tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'campaign_strategies',
    'content_pillars', 
    'platform_strategies',
    'campaign_performance_metrics',
    'ai_enhancement_logs',
    'content_templates_enhanced',
    'weekly_content_refinements',
    'daily_content_plans',
    'campaigns'
)
ORDER BY table_name;

-- Check campaigns table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'campaigns' 
ORDER BY ordinal_position;



