-- =====================================================
-- COMPLETE INTEGRATION MIGRATION - P0, P1, P2
-- =====================================================
-- This script safely adds ALL required tables, columns, indexes, and functions
-- for P0 (Queue, Scheduler, OAuth), P1 (Media, Posting), and P2 (Analytics, Templates, Teams, Activity)
-- 
-- FEATURES:
-- - Fully idempotent (can run multiple times safely)
-- - Checks for existence before creating
-- - Includes all foreign key constraints
-- - Includes all performance indexes
-- 
-- RUN INSTRUCTIONS:
-- 1. Copy this entire script
-- 2. Open Supabase SQL Editor
-- 3. Paste and execute
-- 4. Verify success (should complete without errors)
-- 
-- UPDATED: Added missing columns and tables:
-- - notifications table (for team assignments)
-- - retweets, quotes, reactions columns (content_analytics)
-- - week_start_date column (weekly_content_refinements)
-- - focus_areas array column (weekly_content_refinements)
-- =====================================================

BEGIN;

-- ==============================================
-- 1. SOCIAL ACCOUNTS (P0 - OAuth Integration)
-- ==============================================

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

-- ==============================================
-- 2. SCHEDULED POSTS (P0/P1 - Core Posting)
-- ==============================================

CREATE TABLE IF NOT EXISTS scheduled_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
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
    
    -- Media Fields (P1)
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
    
    -- Scheduling
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'pending', 'processing', 'published', 'failed', 'cancelled')),
    
    -- P2: Priority and Error Handling
    priority INTEGER DEFAULT 0,
    error_code VARCHAR(100),
    error_message TEXT,
    
    -- Publishing Results (P0)
    platform_post_id VARCHAR(255),
    post_url TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 3. QUEUE JOBS (P0 - Queue System)
-- ==============================================

CREATE TABLE IF NOT EXISTS queue_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL DEFAULT 'publish',
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    priority INTEGER DEFAULT 0,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    error_code VARCHAR(100),
    result_data JSONB,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 4. QUEUE JOB LOGS (P0 - Queue System)
-- ==============================================

CREATE TABLE IF NOT EXISTS queue_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES queue_jobs(id) ON DELETE CASCADE,
    log_level VARCHAR(20) NOT NULL CHECK (log_level IN ('debug', 'info', 'warning', 'error')),
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 5. MEDIA FILES (P1 - Media Management)
-- ==============================================

CREATE TABLE IF NOT EXISTS media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'document')),
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    storage_provider VARCHAR(50) DEFAULT 'supabase',
    storage_bucket VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 6. SCHEDULED POST MEDIA (P1 - Media Linking)
-- ==============================================

CREATE TABLE IF NOT EXISTS scheduled_post_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    media_file_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, media_file_id)
);

-- ==============================================
-- 7. CONTENT ANALYTICS (P2 - Analytics)
-- ==============================================

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
    clicks INTEGER DEFAULT 0,
    
    -- Platform-Specific Metrics (Twitter/X, Facebook, LinkedIn)
    retweets INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    
    -- Platform-Specific Metrics (stored in JSONB for flexibility)
    platform_metrics JSONB DEFAULT '{}',
    
    -- Calculated Fields
    engagement_rate NUMERIC(5, 2),
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, analytics_date)
);

-- ==============================================
-- 8. PLATFORM PERFORMANCE (P2 - Analytics)
-- ==============================================

CREATE TABLE IF NOT EXISTS platform_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    
    -- Aggregated Metrics
    total_posts INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_shares INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,
    
    -- Calculated Metrics
    avg_engagement_rate NUMERIC(5, 2),
    total_reach INTEGER DEFAULT 0,
    total_impressions INTEGER DEFAULT 0,
    
    -- Breakdowns
    content_type_breakdown JSONB DEFAULT '{}',
    best_performing_posts UUID[],
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, date)
);

-- ==============================================
-- 9. HASHTAG PERFORMANCE (P2 - Analytics)
-- ==============================================

CREATE TABLE IF NOT EXISTS hashtag_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hashtag VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    
    usage_count INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,
    avg_engagement_rate NUMERIC(5, 2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, hashtag, platform, date)
);

-- ==============================================
-- 10. CONTENT TEMPLATES (P2 - Templates)
-- ==============================================

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
    media_requirements JSONB DEFAULT '{}',
    variables JSONB DEFAULT '{}',
    tags TEXT[],
    is_public BOOLEAN DEFAULT FALSE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 11. WEEKLY CONTENT REFINEMENTS (P1/P2 - Campaign Planning)
-- ==============================================

CREATE TABLE IF NOT EXISTS weekly_content_refinements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    theme VARCHAR(255),
    focus_area TEXT,
    focus_areas TEXT[], -- Array version for multiple focus areas
    marketing_channels TEXT[],
    existing_content TEXT,
    content_notes TEXT,
    week_start_date DATE, -- Start date for the week (used in scheduling)
    
    -- P2: Team Assignments
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'cancelled')),
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    
    content_plan JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (campaign_id, week_number)
);

-- ==============================================
-- 12. DAILY CONTENT PLANS (P1 - Campaign Planning)
-- ==============================================

CREATE TABLE IF NOT EXISTS daily_content_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    weekly_refinement_id UUID REFERENCES weekly_content_refinements(id) ON DELETE CASCADE,
    scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    day_of_week VARCHAR(20),
    content_type VARCHAR(100),
    platform VARCHAR(50),
    theme VARCHAR(255),
    content_description TEXT,
    hashtags TEXT[],
    media_requirements TEXT[],
    status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'created', 'scheduled', 'published')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (campaign_id, date)
);

-- ==============================================
-- 13. NOTIFICATIONS (P2 - Team Notifications)
-- ==============================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 14. ACTIVITY FEED (P2 - Activity Logging)
-- ==============================================

CREATE TABLE IF NOT EXISTS activity_feed (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 14. ADD MISSING COLUMNS TO EXISTING TABLES
-- ==============================================
-- These ALTER TABLE statements ensure columns are added even if tables already exist

-- Add priority column to scheduled_posts if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'scheduled_posts' 
        AND column_name = 'priority'
    ) THEN
        ALTER TABLE scheduled_posts ADD COLUMN priority INTEGER DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_priority ON scheduled_posts(priority);
    END IF;
END $$;

-- Add error_code and error_message columns to scheduled_posts if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'scheduled_posts' 
        AND column_name = 'error_code'
    ) THEN
        ALTER TABLE scheduled_posts 
        ADD COLUMN error_code VARCHAR(100),
        ADD COLUMN error_message TEXT;
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_error_code ON scheduled_posts(error_code);
    END IF;
END $$;

-- Add priority column to queue_jobs if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'queue_jobs' 
        AND column_name = 'priority'
    ) THEN
        ALTER TABLE queue_jobs ADD COLUMN priority INTEGER DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_priority ON queue_jobs(priority);
    END IF;
END $$;

-- Add retweets, quotes, reactions to content_analytics if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'content_analytics' 
        AND column_name = 'retweets'
    ) THEN
        ALTER TABLE content_analytics 
        ADD COLUMN retweets INTEGER DEFAULT 0,
        ADD COLUMN quotes INTEGER DEFAULT 0,
        ADD COLUMN reactions INTEGER DEFAULT 0;
    END IF;
END $$;

-- Add week_start_date and focus_areas to weekly_content_refinements if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'weekly_content_refinements' 
        AND column_name = 'week_start_date'
    ) THEN
        ALTER TABLE weekly_content_refinements 
        ADD COLUMN week_start_date DATE,
        ADD COLUMN focus_areas TEXT[];
    END IF;
END $$;

-- ==============================================
-- 15. INDEXES FOR PERFORMANCE
-- ==============================================

-- Social Accounts Indexes
CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_social_accounts_active ON social_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_social_accounts_user_platform ON social_accounts(user_id, platform);

-- Scheduled Posts Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id ON scheduled_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_campaign_id ON scheduled_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_platform ON scheduled_posts(platform);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_for ON scheduled_posts(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_priority ON scheduled_posts(priority);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_error_code ON scheduled_posts(error_code);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_priority_scheduled 
    ON scheduled_posts(status, priority DESC, scheduled_for) 
    WHERE status = 'scheduled';

-- Queue Jobs Indexes
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled_for ON queue_jobs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_priority ON queue_jobs(priority);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled_post_id ON queue_jobs(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status_scheduled ON queue_jobs(status, scheduled_for) WHERE status IN ('pending', 'processing');

-- Queue Job Logs Indexes
CREATE INDEX IF NOT EXISTS idx_queue_job_logs_job_id ON queue_job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_queue_job_logs_level ON queue_job_logs(log_level);

-- Media Files Indexes
CREATE INDEX IF NOT EXISTS idx_media_files_user_id ON media_files(user_id);
CREATE INDEX IF NOT EXISTS idx_media_files_campaign_id ON media_files(campaign_id);
CREATE INDEX IF NOT EXISTS idx_media_files_media_type ON media_files(media_type);

-- Scheduled Post Media Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_post_media_post_id ON scheduled_post_media(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_post_media_file_id ON scheduled_post_media(media_file_id);

-- Content Analytics Indexes
CREATE INDEX IF NOT EXISTS idx_content_analytics_post_id ON content_analytics(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_content_analytics_date ON content_analytics(analytics_date);
CREATE INDEX IF NOT EXISTS idx_content_analytics_user_date ON content_analytics(user_id, analytics_date);
CREATE INDEX IF NOT EXISTS idx_content_analytics_platform ON content_analytics(platform);

-- Platform Performance Indexes
CREATE INDEX IF NOT EXISTS idx_platform_performance_user_date ON platform_performance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_platform_performance_platform ON platform_performance(platform);

-- Hashtag Performance Indexes
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_user ON hashtag_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_hashtag ON hashtag_performance(hashtag);
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_date ON hashtag_performance(date);

-- Content Templates Indexes
CREATE INDEX IF NOT EXISTS idx_content_templates_user_id ON content_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_content_templates_campaign_id ON content_templates(campaign_id);
CREATE INDEX IF NOT EXISTS idx_content_templates_platform ON content_templates(platform);
CREATE INDEX IF NOT EXISTS idx_content_templates_public ON content_templates(is_public) WHERE is_public = TRUE;

-- Weekly Refinements Indexes
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_campaign ON weekly_content_refinements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_assigned ON weekly_content_refinements(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_refinements_status ON weekly_content_refinements(status);

-- Daily Plans Indexes
CREATE INDEX IF NOT EXISTS idx_daily_plans_campaign ON daily_content_plans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_content_plans(date);
CREATE INDEX IF NOT EXISTS idx_daily_plans_scheduled_post_id ON daily_content_plans(scheduled_post_id);

-- Notifications Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);

-- Activity Feed Indexes
CREATE INDEX IF NOT EXISTS idx_activity_feed_user_id ON activity_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_campaign_id ON activity_feed(campaign_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_created_at ON activity_feed(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_feed_action_type ON activity_feed(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_feed_user_created ON activity_feed(user_id, created_at DESC);

-- Campaign Conflict Detection Index
CREATE INDEX IF NOT EXISTS idx_campaigns_user_dates 
    ON campaigns(user_id, start_date, end_date) 
    WHERE status NOT IN ('completed', 'cancelled');

-- ==============================================
-- 15. FUNCTIONS
-- ==============================================

-- Function: Increment Template Usage (P2)
CREATE OR REPLACE FUNCTION increment_template_usage(template_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE content_templates
    SET usage_count = usage_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = template_id;
END;
$$ LANGUAGE plpgsql;

-- ==============================================
-- 16. COMMENTS FOR DOCUMENTATION
-- ==============================================

COMMENT ON TABLE social_accounts IS 'OAuth-connected social media accounts with encrypted tokens';
COMMENT ON TABLE scheduled_posts IS 'Posts scheduled for publishing with content, media, and scheduling info';
COMMENT ON TABLE queue_jobs IS 'Background job queue for processing scheduled posts';
COMMENT ON TABLE queue_job_logs IS 'Execution logs for queue jobs';
COMMENT ON TABLE media_files IS 'Uploaded media files (images, videos, audio)';
COMMENT ON TABLE scheduled_post_media IS 'Linking table between scheduled posts and media files';
COMMENT ON TABLE content_analytics IS 'Post-level engagement analytics';
COMMENT ON TABLE platform_performance IS 'Aggregated platform performance metrics';
COMMENT ON TABLE hashtag_performance IS 'Hashtag performance tracking';
COMMENT ON TABLE content_templates IS 'Reusable content templates with variable substitution';
COMMENT ON TABLE notifications IS 'User notifications for assignments and system events';
COMMENT ON TABLE weekly_content_refinements IS 'Weekly campaign content plans with team assignments';
COMMENT ON TABLE daily_content_plans IS 'Daily content plans linked to campaigns and weekly refinements';
COMMENT ON TABLE activity_feed IS 'Audit log and activity feed for all user actions';

COMMENT ON COLUMN scheduled_posts.priority IS 'Post priority: 0 = normal, >0 = high priority (processed first)';
COMMENT ON COLUMN scheduled_posts.error_code IS 'Categorized error code for analytics and recovery';
COMMENT ON COLUMN weekly_content_refinements.assigned_to_user_id IS 'Team member assigned to work on this week';

COMMIT;

-- =====================================================
-- VERIFICATION QUERIES (Run these after migration)
-- =====================================================

-- Check table counts
-- SELECT 'social_accounts' as table_name, COUNT(*) as row_count FROM social_accounts
-- UNION ALL
-- SELECT 'scheduled_posts', COUNT(*) FROM scheduled_posts
-- UNION ALL
-- SELECT 'queue_jobs', COUNT(*) FROM queue_jobs
-- UNION ALL
-- SELECT 'media_files', COUNT(*) FROM media_files
-- UNION ALL
-- SELECT 'content_templates', COUNT(*) FROM content_templates
-- UNION ALL
-- SELECT 'activity_feed', COUNT(*) FROM activity_feed;

-- Check indexes
-- SELECT schemaname, tablename, indexname 
-- FROM pg_indexes 
-- WHERE schemaname = 'public' 
-- AND tablename IN ('scheduled_posts', 'queue_jobs', 'social_accounts', 'content_analytics')
-- ORDER BY tablename, indexname;

