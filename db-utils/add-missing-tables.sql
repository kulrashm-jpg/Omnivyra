-- ADD MISSING TABLES TO EXISTING DATABASE
-- This script adds only the missing tables without conflicting with existing ones
-- Run this in Supabase SQL Editor

-- ==============================================
-- 1. SOCIAL MEDIA MANAGEMENT TABLES
-- ==============================================

-- Social Accounts Table (unified for all platforms)
CREATE TABLE IF NOT EXISTS social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL, -- 'linkedin', 'twitter', 'instagram', 'youtube', 'facebook'
    platform_user_id VARCHAR(255) NOT NULL, -- User ID on the social platform
    account_name VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    profile_picture_url TEXT,
    follower_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    permissions TEXT[], -- Array of granted permissions/scopes
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, platform_user_id)
);

-- Content Templates Table (for reusable content)
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
    media_requirements JSONB, -- Media type, size, format requirements
    variables JSONB, -- Template variables like {name}, {company}
    tags TEXT[],
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled Posts Table (main scheduling entity)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    template_id UUID REFERENCES content_templates(id) ON DELETE SET NULL,
    
    -- Platform and Content Info
    platform VARCHAR(50) NOT NULL, -- 'linkedin', 'twitter', 'instagram', 'youtube', 'facebook'
    content_type VARCHAR(100) NOT NULL, -- 'post', 'article', 'video', 'tweet', 'story', 'reel', etc.
    
    -- Content Fields
    title VARCHAR(500),
    content TEXT NOT NULL,
    hashtags TEXT[],
    mentions TEXT[], -- @mentions
    location VARCHAR(200),
    alt_text TEXT, -- For accessibility
    
    -- Media Fields (unified)
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
    
    -- Audio Specific (for LinkedIn audio events, Instagram Reels)
    audio_duration INTEGER,
    audio_title VARCHAR(200),
    audio_url VARCHAR(500),
    audio_artist VARCHAR(200),
    
    -- Thread/Series Specific (for Twitter threads, Instagram carousels)
    parent_post_id UUID REFERENCES scheduled_posts(id),
    thread_position INTEGER,
    is_thread_start BOOLEAN DEFAULT FALSE,
    thread_title VARCHAR(500),
    
    -- Stickers/Interactive Elements (for Stories)
    stickers JSONB,
    interactive_elements JSONB, -- Polls, questions, etc.
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'
    published_at TIMESTAMP WITH TIME ZONE,
    post_url TEXT, -- URL of the published post
    platform_post_id VARCHAR(255), -- ID returned by the social platform
    
    -- Error Handling
    error_message TEXT,
    error_code VARCHAR(100),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- AI Assessment
    ai_score INTEGER, -- AI assessment score for this specific post
    uniqueness_score INTEGER, -- AI score for uniqueness
    repetition_score INTEGER, -- AI score for repetition
    engagement_prediction INTEGER, -- Predicted engagement score
    
    -- Performance Tracking
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0, -- Instagram saves
    retweets INTEGER DEFAULT 0, -- Twitter retweets
    quotes INTEGER DEFAULT 0, -- Twitter quotes
    reactions INTEGER DEFAULT 0, -- Facebook reactions
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Recurring Posts Table (for automated posting)
CREATE TABLE IF NOT EXISTS recurring_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    
    -- Recurring Settings
    name VARCHAR(255) NOT NULL,
    description TEXT,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    
    -- Content Template
    content_template TEXT NOT NULL,
    hashtags TEXT[],
    media_template JSONB, -- Template for media requirements
    
    -- Scheduling
    frequency VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly', 'custom'
    interval_value INTEGER DEFAULT 1, -- Every X days/weeks/months
    days_of_week INTEGER[], -- 0=Sunday, 1=Monday, etc.
    time_of_day TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    next_post_at TIMESTAMP WITH TIME ZONE,
    last_posted_at TIMESTAMP WITH TIME ZONE,
    total_posts INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 2. MEDIA MANAGEMENT TABLES
-- ==============================================

-- Media Files Table (centralized media storage)
CREATE TABLE IF NOT EXISTS media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    
    -- File Information
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255),
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_extension VARCHAR(10),
    
    -- Media Properties
    media_type VARCHAR(50) NOT NULL, -- 'image', 'video', 'audio', 'document'
    width INTEGER,
    height INTEGER,
    duration INTEGER, -- For video/audio
    aspect_ratio VARCHAR(10),
    
    -- Platform Compatibility
    platforms TEXT[], -- Which platforms this media is compatible with
    platform_specific_data JSONB, -- Platform-specific metadata
    
    -- AI Analysis
    ai_tags TEXT[], -- AI-generated tags
    ai_description TEXT, -- AI-generated description
    content_moderation_score DECIMAL(3,2), -- 0.00 to 1.00
    
    -- Usage Tracking
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled Post Media Junction Table
CREATE TABLE IF NOT EXISTS scheduled_post_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    media_file_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 1, -- Order of media in post
    platform_specific_data JSONB, -- Platform-specific media settings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, media_file_id, position)
);

-- ==============================================
-- 3. BACKGROUND PROCESSING TABLES
-- ==============================================

-- Queue Jobs Table (for background processing)
CREATE TABLE IF NOT EXISTS queue_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL, -- 'publish', 'retry', 'analytics', 'media_processing'
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    priority INTEGER DEFAULT 0, -- Higher number = higher priority
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    error_code VARCHAR(100),
    metadata JSONB, -- Additional job data
    result_data JSONB, -- Job result data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Queue Job Logs Table (detailed logging)
CREATE TABLE IF NOT EXISTS queue_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES queue_jobs(id) ON DELETE CASCADE,
    log_level VARCHAR(20) NOT NULL, -- 'debug', 'info', 'warn', 'error'
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 4. CAMPAIGN PLANNING TABLES (CRITICAL FOR 12-WEEK PLANS)
-- ==============================================

-- Weekly Content Refinements Table (CRITICAL - Missing from API)
CREATE TABLE IF NOT EXISTS weekly_content_refinements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    theme VARCHAR(255),
    focus_area TEXT,
    ai_suggestions TEXT[],
    refinement_status VARCHAR(50) DEFAULT 'ai_enhanced', -- 'ai_enhanced', 'user_edited', 'approved'
    content_plan JSONB DEFAULT '{}',
    performance_targets JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (campaign_id, week_number)
);

-- Daily Content Plans Table (CRITICAL - Missing from API)
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
    status VARCHAR(50) DEFAULT 'planned', -- 'planned', 'created', 'reviewed', 'scheduled', 'published', 'failed'
    ai_generated BOOLEAN DEFAULT false,
    scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE
);

-- ==============================================
-- 5. ANALYTICS & PERFORMANCE TABLES
-- ==============================================

-- Content Analytics Table (daily engagement metrics)
CREATE TABLE IF NOT EXISTS content_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    analytics_date DATE NOT NULL,
    
    -- Engagement Metrics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    
    -- Calculated Metrics
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    
    -- Platform-specific metrics
    platform_metrics JSONB DEFAULT '{}',
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, analytics_date)
);

-- Platform Performance Summary Table
CREATE TABLE IF NOT EXISTS platform_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    
    -- Daily Summary
    total_posts INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_shares INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Best Performing Post
    best_post_id UUID REFERENCES scheduled_posts(id),
    best_post_engagement DECIMAL(5,2) DEFAULT 0.00,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, date)
);

-- Hashtag Performance Table
CREATE TABLE IF NOT EXISTS hashtag_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hashtag VARCHAR(100) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    
    -- Performance Metrics
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
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    analysis_type VARCHAR(50) NOT NULL, -- 'content_quality', 'engagement_prediction', 'brand_safety'
    score DECIMAL(3,2) NOT NULL, -- 0.00 to 1.00
    confidence DECIMAL(3,2) NOT NULL, -- 0.00 to 1.00
    analysis_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optimal Posting Times Table
CREATE TABLE IF NOT EXISTS optimal_posting_times (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, etc.
    hour INTEGER NOT NULL, -- 0-23
    engagement_score DECIMAL(3,2) NOT NULL, -- 0.00 to 1.00
    sample_size INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, day_of_week, hour)
);

-- ==============================================
-- 6. SYSTEM FEATURES TABLES
-- ==============================================

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'post_published', 'post_failed', 'campaign_complete', etc.
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
-- 7. CREATE INDEXES FOR PERFORMANCE
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

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_content_analytics_post_id ON content_analytics(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_content_analytics_date ON content_analytics(analytics_date);
CREATE INDEX IF NOT EXISTS idx_platform_performance_user_date ON platform_performance(user_id, date);

-- Campaign Planning indexes
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_campaign ON weekly_content_refinements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_campaign ON daily_content_plans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_content_plans(date);

-- ==============================================
-- 8. SUCCESS MESSAGE
-- ==============================================

SELECT 'Missing database tables added successfully! Campaign planning should now work.' as message;
