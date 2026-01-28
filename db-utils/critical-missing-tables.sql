-- CRITICAL MISSING TABLES FOR CAMPAIGN PLANNING
-- This script adds only the most essential tables to fix "Failed to create plan" error
-- Run this in Supabase SQL Editor

-- ==============================================
-- 1. CAMPAIGN PLANNING TABLES (CRITICAL)
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
    scheduled_post_id UUID, -- Will reference scheduled_posts after it's created
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE
);

-- ==============================================
-- 2. SOCIAL MEDIA MANAGEMENT TABLES (CRITICAL)
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

-- Scheduled Posts Table (main scheduling entity)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    
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

-- ==============================================
-- 3. ADD FOREIGN KEY CONSTRAINT FOR DAILY CONTENT PLANS
-- ==============================================

-- Add the foreign key constraint to daily_content_plans after scheduled_posts is created
-- Only add if constraint doesn't already exist and both tables exist
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
-- 4. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Campaign Planning indexes
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_campaign ON weekly_content_refinements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_campaign ON daily_content_plans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_content_plans(date);

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

-- Content Templates indexes
CREATE INDEX IF NOT EXISTS idx_content_templates_user_id ON content_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_content_templates_platform ON content_templates(platform);

-- ==============================================
-- 5. SUCCESS MESSAGE
-- ==============================================

SELECT 'Critical missing tables added successfully! Campaign planning should now work.' as message;


