-- =====================================================
-- SAFE DATABASE MIGRATION SCRIPT
-- =====================================================
-- This script safely adds all missing tables, columns, and constraints
-- Can be run multiple times without errors (idempotent)
-- Run this in Supabase SQL Editor
-- =====================================================

-- ==============================================
-- 1. SOCIAL MEDIA MANAGEMENT TABLES
-- ==============================================

-- Social Accounts Table
CREATE TABLE IF NOT EXISTS social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    platform_user_id VARCHAR(255) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    profile_picture_url TEXT,
    follower_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    permissions TEXT[],
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, platform_user_id)
);

-- Content Templates Table
CREATE TABLE IF NOT EXISTS content_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    hashtags TEXT[],
    media_requirements JSONB,
    variables JSONB,
    tags TEXT[],
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled Posts Table (must be created before tables that reference it)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    template_id UUID,
    
    -- Platform and Content Info
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    
    -- Content Fields
    title VARCHAR(500),
    content TEXT NOT NULL,
    hashtags TEXT[],
    mentions TEXT[],
    location VARCHAR(200),
    alt_text TEXT,
    
    -- Media Fields
    media_urls TEXT[],
    media_types VARCHAR(20)[],
    media_sizes BIGINT[],
    media_formats VARCHAR(10)[],
    
    -- Video Specific
    video_duration INTEGER,
    video_resolution VARCHAR(20),
    video_aspect_ratio VARCHAR(10),
    video_bitrate INTEGER,
    video_fps INTEGER,
    video_thumbnail_url TEXT,
    
    -- Image Specific
    image_width INTEGER,
    image_height INTEGER,
    image_aspect_ratio VARCHAR(10),
    
    -- Audio Specific
    audio_duration INTEGER,
    audio_title VARCHAR(200),
    audio_url VARCHAR(500),
    audio_artist VARCHAR(200),
    
    -- Thread/Series Specific
    parent_post_id UUID,
    thread_position INTEGER,
    is_thread_start BOOLEAN DEFAULT FALSE,
    thread_title VARCHAR(500),
    
    -- Interactive Elements
    stickers JSONB,
    interactive_elements JSONB,
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    status VARCHAR(50) DEFAULT 'draft',
    published_at TIMESTAMP WITH TIME ZONE,
    post_url TEXT,
    platform_post_id VARCHAR(255),
    
    -- Error Handling
    error_message TEXT,
    error_code VARCHAR(100),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- AI Assessment
    ai_score INTEGER,
    uniqueness_score INTEGER,
    repetition_score INTEGER,
    engagement_prediction INTEGER,
    
    -- Performance Tracking
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraints to scheduled_posts after both tables exist
DO $$
BEGIN
    -- Add social_account_id foreign key if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'scheduled_posts_social_account_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'social_accounts'
    ) THEN
        ALTER TABLE scheduled_posts 
        ADD CONSTRAINT scheduled_posts_social_account_id_fkey 
        FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE;
    END IF;
    
    -- Add template_id foreign key if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'scheduled_posts_template_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'content_templates'
    ) THEN
        ALTER TABLE scheduled_posts 
        ADD CONSTRAINT scheduled_posts_template_id_fkey 
        FOREIGN KEY (template_id) REFERENCES content_templates(id) ON DELETE SET NULL;
    END IF;
    
    -- Add parent_post_id self-reference if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'scheduled_posts_parent_post_id_fkey'
    ) THEN
        ALTER TABLE scheduled_posts 
        ADD CONSTRAINT scheduled_posts_parent_post_id_fkey 
        FOREIGN KEY (parent_post_id) REFERENCES scheduled_posts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ==============================================
-- 2. CAMPAIGN PLANNING TABLES
-- ==============================================

-- Weekly Content Refinements Table
CREATE TABLE IF NOT EXISTS weekly_content_refinements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    theme VARCHAR(255),
    focus_area TEXT,
    ai_suggestions TEXT[],
    refinement_status VARCHAR(50) DEFAULT 'ai_enhanced',
    content_plan JSONB DEFAULT '{}',
    performance_targets JSONB DEFAULT '{}',
    marketing_channels TEXT[],
    existing_content TEXT,
    content_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (campaign_id, week_number)
);

-- Daily Content Plans Table
CREATE TABLE IF NOT EXISTS daily_content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    day_of_week VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    platform VARCHAR(100) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    topic TEXT,
    content TEXT,
    hashtags TEXT[],
    media_requirements JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'planned',
    ai_generated BOOLEAN DEFAULT false,
    scheduled_post_id UUID,
    marketing_channels TEXT[],
    existing_content TEXT,
    content_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE
);

-- Add foreign key constraint for scheduled_post_id safely
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'scheduled_posts'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'daily_content_plans'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'daily_content_plans' 
        AND column_name = 'scheduled_post_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_daily_content_plans_scheduled_post_id'
    ) THEN
        ALTER TABLE daily_content_plans 
        ADD CONSTRAINT fk_daily_content_plans_scheduled_post_id 
        FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ==============================================
-- 3. MEDIA MANAGEMENT TABLES
-- ==============================================

-- Media Files Table
CREATE TABLE IF NOT EXISTS media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255),
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_extension VARCHAR(10),
    media_type VARCHAR(50) NOT NULL,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    aspect_ratio VARCHAR(10),
    platforms TEXT[],
    platform_specific_data JSONB,
    ai_tags TEXT[],
    ai_description TEXT,
    content_moderation_score DECIMAL(3,2),
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled Post Media Junction Table
CREATE TABLE IF NOT EXISTS scheduled_post_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL,
    media_file_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 1,
    platform_specific_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, media_file_id, position)
);

-- Add foreign key for scheduled_post_media
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'scheduled_post_media_scheduled_post_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'scheduled_posts'
    ) THEN
        ALTER TABLE scheduled_post_media 
        ADD CONSTRAINT scheduled_post_media_scheduled_post_id_fkey 
        FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ==============================================
-- 4. BACKGROUND PROCESSING TABLES
-- ==============================================

-- Queue Jobs Table
CREATE TABLE IF NOT EXISTS queue_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL,
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    error_code VARCHAR(100),
    metadata JSONB,
    result_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key for queue_jobs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'queue_jobs_scheduled_post_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'scheduled_posts'
    ) THEN
        ALTER TABLE queue_jobs 
        ADD CONSTRAINT queue_jobs_scheduled_post_id_fkey 
        FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Queue Job Logs Table
CREATE TABLE IF NOT EXISTS queue_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES queue_jobs(id) ON DELETE CASCADE,
    log_level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Recurring Posts Table
CREATE TABLE IF NOT EXISTS recurring_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    content_template TEXT NOT NULL,
    hashtags TEXT[],
    media_template JSONB,
    frequency VARCHAR(50) NOT NULL,
    interval_value INTEGER DEFAULT 1,
    days_of_week INTEGER[],
    time_of_day TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_active BOOLEAN DEFAULT TRUE,
    next_post_at TIMESTAMP WITH TIME ZONE,
    last_posted_at TIMESTAMP WITH TIME ZONE,
    total_posts INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key for recurring_posts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'recurring_posts_social_account_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'social_accounts'
    ) THEN
        ALTER TABLE recurring_posts 
        ADD CONSTRAINT recurring_posts_social_account_id_fkey 
        FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ==============================================
-- 5. ANALYTICS & PERFORMANCE TABLES
-- ==============================================

-- Content Analytics Table
CREATE TABLE IF NOT EXISTS content_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    analytics_date DATE NOT NULL,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    platform_metrics JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, analytics_date)
);

-- Add foreign key for content_analytics
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'content_analytics_scheduled_post_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'scheduled_posts'
    ) THEN
        ALTER TABLE content_analytics 
        ADD CONSTRAINT content_analytics_scheduled_post_id_fkey 
        FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Platform Performance Summary Table
CREATE TABLE IF NOT EXISTS platform_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    total_posts INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_shares INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    best_post_id UUID,
    best_post_engagement DECIMAL(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, date)
);

-- Add foreign key for platform_performance
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'platform_performance_best_post_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'scheduled_posts'
    ) THEN
        ALTER TABLE platform_performance 
        ADD CONSTRAINT platform_performance_best_post_id_fkey 
        FOREIGN KEY (best_post_id) REFERENCES scheduled_posts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Hashtag Performance Table
CREATE TABLE IF NOT EXISTS hashtag_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hashtag VARCHAR(100) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    usage_count INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, hashtag, platform, date)
);

-- AI Content Analysis Table
CREATE TABLE IF NOT EXISTS ai_content_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL,
    analysis_type VARCHAR(50) NOT NULL,
    score DECIMAL(3,2) NOT NULL,
    confidence DECIMAL(3,2) NOT NULL,
    analysis_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key for ai_content_analysis
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'ai_content_analysis_scheduled_post_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'scheduled_posts'
    ) THEN
        ALTER TABLE ai_content_analysis 
        ADD CONSTRAINT ai_content_analysis_scheduled_post_id_fkey 
        FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Optimal Posting Times Table
CREATE TABLE IF NOT EXISTS optimal_posting_times (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    day_of_week INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    engagement_score DECIMAL(3,2) NOT NULL,
    sample_size INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, day_of_week, hour)
);

-- Audience Insights Table
CREATE TABLE IF NOT EXISTS audience_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    social_account_id UUID NOT NULL,
    date DATE NOT NULL,
    age_groups JSONB DEFAULT '{}',
    gender_distribution JSONB DEFAULT '{}',
    location_distribution JSONB DEFAULT '{}',
    interests JSONB DEFAULT '{}',
    peak_hours JSONB DEFAULT '{}',
    peak_days JSONB DEFAULT '{}',
    content_preferences JSONB DEFAULT '{}',
    follower_growth INTEGER DEFAULT 0,
    engagement_trend DECIMAL(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, social_account_id, date)
);

-- Add foreign key for audience_insights
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'audience_insights_social_account_id_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'social_accounts'
    ) THEN
        ALTER TABLE audience_insights 
        ADD CONSTRAINT audience_insights_social_account_id_fkey 
        FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Competitor Analysis Table
CREATE TABLE IF NOT EXISTS competitor_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    competitor_name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    competitor_handle VARCHAR(255) NOT NULL,
    follower_count INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    posting_frequency DECIMAL(5,2) DEFAULT 0.00,
    content_themes JSONB DEFAULT '{}',
    top_performing_content JSONB DEFAULT '{}',
    growth_rate DECIMAL(5,2) DEFAULT 0.00,
    engagement_comparison DECIMAL(5,2) DEFAULT 0.00,
    last_analyzed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, competitor_name, platform)
);

-- ROI Analysis Table
CREATE TABLE IF NOT EXISTS roi_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    analysis_date DATE NOT NULL,
    time_invested_hours DECIMAL(5,2) DEFAULT 0.00,
    content_creation_cost DECIMAL(10,2) DEFAULT 0.00,
    advertising_spend DECIMAL(10,2) DEFAULT 0.00,
    total_investment DECIMAL(10,2) DEFAULT 0.00,
    leads_generated INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue_generated DECIMAL(10,2) DEFAULT 0.00,
    brand_awareness_score DECIMAL(5,2) DEFAULT 0.00,
    roi_percentage DECIMAL(5,2) DEFAULT 0.00,
    cost_per_lead DECIMAL(10,2) DEFAULT 0.00,
    cost_per_conversion DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, campaign_id, platform, analysis_date)
);

-- ==============================================
-- 6. SYSTEM FEATURES TABLES
-- ==============================================

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Platform Configurations Table
CREATE TABLE IF NOT EXISTS platform_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL UNIQUE,
    configuration JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 7. ADD MISSING COLUMNS TO EXISTING TABLES
-- ==============================================

-- Add columns to campaigns table
DO $$
BEGIN
    -- Add key_messages column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaigns' AND column_name = 'key_messages'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN key_messages TEXT[];
    END IF;
    
    -- Add success_metrics column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaigns' AND column_name = 'success_metrics'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN success_metrics TEXT[];
    END IF;
END $$;

-- ==============================================
-- 8. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Social Accounts indexes
CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_social_accounts_active ON social_accounts(is_active);

-- Scheduled Posts indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id ON scheduled_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_campaign_id ON scheduled_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_platform ON scheduled_posts(platform);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_for ON scheduled_posts(scheduled_for);

-- Queue Jobs indexes
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled_for ON queue_jobs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_priority ON queue_jobs(priority);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled_post_id ON queue_jobs(scheduled_post_id);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_content_analytics_post_id ON content_analytics(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_content_analytics_date ON content_analytics(analytics_date);
CREATE INDEX IF NOT EXISTS idx_content_analytics_user_date ON content_analytics(user_id, analytics_date);
CREATE INDEX IF NOT EXISTS idx_platform_performance_user_date ON platform_performance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_user ON hashtag_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_analysis_post_id ON ai_content_analysis(scheduled_post_id);

-- Campaign Planning indexes
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_campaign ON weekly_content_refinements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_campaign ON daily_content_plans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_content_plans(date);
CREATE INDEX IF NOT EXISTS idx_daily_plans_scheduled_post_id ON daily_content_plans(scheduled_post_id);

-- Media Files indexes
CREATE INDEX IF NOT EXISTS idx_media_files_user_id ON media_files(user_id);
CREATE INDEX IF NOT EXISTS idx_media_files_campaign_id ON media_files(campaign_id);
CREATE INDEX IF NOT EXISTS idx_media_files_media_type ON media_files(media_type);

-- Scheduled Post Media indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_post_media_post_id ON scheduled_post_media(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_post_media_file_id ON scheduled_post_media(media_file_id);

-- Queue Job Logs indexes
CREATE INDEX IF NOT EXISTS idx_queue_job_logs_job_id ON queue_job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_queue_job_logs_level ON queue_job_logs(log_level);

-- Recurring Posts indexes
CREATE INDEX IF NOT EXISTS idx_recurring_posts_user_id ON recurring_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_posts_active ON recurring_posts(is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_posts_next_post ON recurring_posts(next_post_at);

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Audience Insights indexes
CREATE INDEX IF NOT EXISTS idx_audience_insights_user ON audience_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_audience_insights_platform ON audience_insights(platform);
CREATE INDEX IF NOT EXISTS idx_audience_insights_date ON audience_insights(date);

-- Competitor Analysis indexes
CREATE INDEX IF NOT EXISTS idx_competitor_analysis_user ON competitor_analysis(user_id);
CREATE INDEX IF NOT EXISTS idx_competitor_analysis_competitor ON competitor_analysis(competitor_name);

-- ROI Analysis indexes
CREATE INDEX IF NOT EXISTS idx_roi_analysis_user ON roi_analysis(user_id);
CREATE INDEX IF NOT EXISTS idx_roi_analysis_campaign ON roi_analysis(campaign_id);
CREATE INDEX IF NOT EXISTS idx_roi_analysis_date ON roi_analysis(analysis_date);

-- ==============================================
-- 9. SUCCESS MESSAGE
-- ==============================================

SELECT '✅ Database migration completed successfully! All tables, columns, constraints, and indexes have been safely added.' as message;

