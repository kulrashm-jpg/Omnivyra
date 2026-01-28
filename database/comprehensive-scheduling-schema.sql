-- COMPREHENSIVE SCHEDULING SYSTEM DATABASE SCHEMA
-- Production-ready schema for complete social media scheduling platform

-- ==============================================
-- CORE SYSTEM TABLES
-- ==============================================

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    preferences JSONB DEFAULT '{}',
    subscription_plan VARCHAR(50) DEFAULT 'free', -- 'free', 'pro', 'enterprise'
    subscription_status VARCHAR(50) DEFAULT 'active', -- 'active', 'cancelled', 'expired'
    subscription_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Social Accounts Table (unified for all platforms)
CREATE TABLE social_accounts (
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

-- ==============================================
-- CAMPAIGN MANAGEMENT
-- ==============================================

-- Campaigns Table
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'active', 'paused', 'completed', 'cancelled'
    budget DECIMAL(10,2),
    goals TEXT[],
    target_audience TEXT,
    brand_voice TEXT,
    content_themes TEXT[],
    hashtag_strategy TEXT,
    posting_schedule JSONB, -- Optimal posting times per platform
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content Templates Table (for reusable content)
CREATE TABLE content_templates (
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
-- CONTENT SCHEDULING
-- ==============================================

-- Scheduled Posts Table (main scheduling entity)
CREATE TABLE scheduled_posts (
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
CREATE TABLE recurring_posts (
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
    media_template JSONB, -- Template for media selection
    
    -- Scheduling
    frequency VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly', 'custom'
    days_of_week INTEGER[], -- 0=Sunday, 1=Monday, etc.
    time_of_day TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Date Range
    start_date DATE NOT NULL,
    end_date DATE,
    max_posts INTEGER, -- Maximum number of posts to create
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_generated_at TIMESTAMP WITH TIME ZONE,
    next_generation_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- MEDIA MANAGEMENT
-- ==============================================

-- Media Files Table (for file management)
CREATE TABLE media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL, -- 'image/jpeg', 'video/mp4', 'audio/mp3'
    file_size_bytes BIGINT NOT NULL,
    storage_url TEXT NOT NULL, -- URL to the stored media file
    thumbnail_url TEXT, -- Optional thumbnail for videos/documents
    dimensions VARCHAR(50), -- '1920x1080'
    duration_seconds INTEGER, -- For video/audio
    metadata JSONB, -- Additional file metadata
    tags TEXT[],
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Junction table for Scheduled Posts and Media Files
CREATE TABLE scheduled_post_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    media_file_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 1, -- Order of media in the post
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheduled_post_id, media_file_id, position)
);

-- ==============================================
-- QUEUE AND BACKGROUND PROCESSING
-- ==============================================

-- Queue Jobs Table (for background processing)
CREATE TABLE queue_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    recurring_post_id UUID REFERENCES recurring_posts(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL, -- 'publish', 'retry', 'analytics', 'generate_recurring'
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    priority INTEGER DEFAULT 0, -- Higher number = higher priority
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    error_code VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Queue Job Logs Table (for debugging and monitoring)
CREATE TABLE queue_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES queue_jobs(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL, -- 'info', 'warn', 'error', 'debug'
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- ANALYTICS AND REPORTING
-- ==============================================

-- Content Analytics (unified for all platforms)
CREATE TABLE content_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    
    -- Date & Time
    date DATE NOT NULL,
    hour INTEGER CHECK (hour >= 0 AND hour <= 23),
    
    -- Engagement Metrics (unified)
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0, -- Instagram saves
    retweets INTEGER DEFAULT 0, -- Twitter retweets
    quotes INTEGER DEFAULT 0, -- Twitter quotes
    reactions INTEGER DEFAULT 0, -- Facebook reactions
    
    -- Calculated Metrics
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    click_through_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Platform Performance Summary
CREATE TABLE platform_performance (
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
CREATE TABLE hashtag_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    hashtag VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    
    -- Performance Metrics
    usage_count INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    reach INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, hashtag, date)
);

-- ==============================================
-- AI AND OPTIMIZATION
-- ==============================================

-- AI Content Analysis Table
CREATE TABLE ai_content_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    analysis_type VARCHAR(50) NOT NULL, -- 'uniqueness', 'engagement', 'sentiment', 'readability'
    score INTEGER NOT NULL, -- 0-100
    confidence DECIMAL(3,2) NOT NULL, -- 0.00-1.00
    details JSONB, -- Detailed analysis results
    suggestions TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optimal Posting Times Table
CREATE TABLE optimal_posting_times (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, etc.
    hour INTEGER NOT NULL, -- 0-23
    engagement_score DECIMAL(5,2) NOT NULL,
    sample_size INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, day_of_week, hour)
);

-- ==============================================
-- NOTIFICATIONS AND ALERTS
-- ==============================================

-- Notifications Table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'post_published', 'post_failed', 'campaign_completed', 'account_disconnected'
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB, -- Additional notification data
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- SYSTEM CONFIGURATION
-- ==============================================

-- Platform Configurations Table
CREATE TABLE platform_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL UNIQUE,
    is_enabled BOOLEAN DEFAULT TRUE,
    posting_limits JSONB NOT NULL, -- Daily/hourly limits
    content_limits JSONB NOT NULL, -- Character limits, hashtag limits, etc.
    media_limits JSONB NOT NULL, -- File size, format, duration limits
    api_configuration JSONB, -- API-specific settings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System Settings Table
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- INDEXES FOR PERFORMANCE
-- ==============================================

-- Users indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_subscription ON users(subscription_plan, subscription_status);

-- Social Accounts indexes
CREATE INDEX idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX idx_social_accounts_active ON social_accounts(is_active);
CREATE INDEX idx_social_accounts_sync ON social_accounts(last_sync_at);

-- Campaigns indexes
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_dates ON campaigns(start_date, end_date);

-- Content Templates indexes
CREATE INDEX idx_content_templates_user_id ON content_templates(user_id);
CREATE INDEX idx_content_templates_platform ON content_templates(platform);
CREATE INDEX idx_content_templates_public ON content_templates(is_public);

-- Scheduled Posts indexes
CREATE INDEX idx_scheduled_posts_user_id ON scheduled_posts(user_id);
CREATE INDEX idx_scheduled_posts_social_account ON scheduled_posts(social_account_id);
CREATE INDEX idx_scheduled_posts_campaign ON scheduled_posts(campaign_id);
CREATE INDEX idx_scheduled_posts_platform ON scheduled_posts(platform);
CREATE INDEX idx_scheduled_posts_content_type ON scheduled_posts(content_type);
CREATE INDEX idx_scheduled_posts_scheduled_for ON scheduled_posts(scheduled_for);
CREATE INDEX idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX idx_scheduled_posts_published_at ON scheduled_posts(published_at);
CREATE INDEX idx_scheduled_posts_retry ON scheduled_posts(next_retry_at) WHERE status = 'failed';
CREATE INDEX idx_scheduled_posts_thread ON scheduled_posts(parent_post_id);

-- Recurring Posts indexes
CREATE INDEX idx_recurring_posts_user_id ON recurring_posts(user_id);
CREATE INDEX idx_recurring_posts_platform ON recurring_posts(platform);
CREATE INDEX idx_recurring_posts_active ON recurring_posts(is_active);
CREATE INDEX idx_recurring_posts_next_generation ON recurring_posts(next_generation_at);

-- Media Files indexes
CREATE INDEX idx_media_files_user_id ON media_files(user_id);
CREATE INDEX idx_media_files_type ON media_files(file_type);
CREATE INDEX idx_media_files_public ON media_files(is_public);

-- Queue Jobs indexes
CREATE INDEX idx_queue_jobs_scheduled_for ON queue_jobs(scheduled_for);
CREATE INDEX idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX idx_queue_jobs_priority ON queue_jobs(priority DESC, scheduled_for);
CREATE INDEX idx_queue_jobs_retry ON queue_jobs(next_retry_at) WHERE status = 'failed';
CREATE INDEX idx_queue_jobs_type ON queue_jobs(job_type);

-- Content Analytics indexes
CREATE INDEX idx_content_analytics_post ON content_analytics(scheduled_post_id);
CREATE INDEX idx_content_analytics_platform ON content_analytics(platform, content_type);
CREATE INDEX idx_content_analytics_date ON content_analytics(date);
CREATE INDEX idx_content_analytics_engagement ON content_analytics(engagement_rate);

-- Platform Performance indexes
CREATE INDEX idx_platform_performance_user ON platform_performance(user_id, platform);
CREATE INDEX idx_platform_performance_date ON platform_performance(date);

-- Hashtag Performance indexes
CREATE INDEX idx_hashtag_performance_user ON hashtag_performance(user_id, platform);
CREATE INDEX idx_hashtag_performance_hashtag ON hashtag_performance(hashtag);
CREATE INDEX idx_hashtag_performance_date ON hashtag_performance(date);

-- AI Content Analysis indexes
CREATE INDEX idx_ai_analysis_post ON ai_content_analysis(scheduled_post_id);
CREATE INDEX idx_ai_analysis_type ON ai_content_analysis(analysis_type);

-- Optimal Posting Times indexes
CREATE INDEX idx_optimal_times_user ON optimal_posting_times(user_id, platform);
CREATE INDEX idx_optimal_times_day_hour ON optimal_posting_times(day_of_week, hour);

-- Notifications indexes
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_type ON notifications(type);

-- ==============================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ==============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_social_accounts_updated_at BEFORE UPDATE ON social_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_content_templates_updated_at BEFORE UPDATE ON content_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduled_posts_updated_at BEFORE UPDATE ON scheduled_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recurring_posts_updated_at BEFORE UPDATE ON recurring_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_queue_jobs_updated_at BEFORE UPDATE ON queue_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_platform_configurations_updated_at BEFORE UPDATE ON platform_configurations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- CONSTRAINTS AND VALIDATIONS
-- ==============================================

-- Platform validation
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_platform CHECK (platform IN ('linkedin', 'twitter', 'instagram', 'youtube', 'facebook'));

-- Content type validation
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_content_type CHECK (
    (platform = 'linkedin' AND content_type IN ('post', 'article', 'video', 'audio_event')) OR
    (platform = 'twitter' AND content_type IN ('tweet', 'thread', 'video')) OR
    (platform = 'instagram' AND content_type IN ('feed_post', 'story', 'reel', 'igtv')) OR
    (platform = 'youtube' AND content_type IN ('video', 'short', 'live')) OR
    (platform = 'facebook' AND content_type IN ('post', 'story', 'video', 'event'))
);

-- Status validation
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_status CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'));

-- Character limits based on platform
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_linkedin_content CHECK (
    platform != 'linkedin' OR LENGTH(content) <= 3000
);

ALTER TABLE scheduled_posts ADD CONSTRAINT chk_twitter_content CHECK (
    platform != 'twitter' OR LENGTH(content) <= 280
);

ALTER TABLE scheduled_posts ADD CONSTRAINT chk_instagram_content CHECK (
    platform != 'instagram' OR LENGTH(content) <= 2200
);

ALTER TABLE scheduled_posts ADD CONSTRAINT chk_youtube_content CHECK (
    platform != 'youtube' OR LENGTH(content) <= 5000
);

ALTER TABLE scheduled_posts ADD CONSTRAINT chk_facebook_content CHECK (
    platform != 'facebook' OR LENGTH(content) <= 63206
);

-- Hashtag limits
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_hashtag_limits CHECK (
    (platform = 'linkedin' AND ARRAY_LENGTH(hashtags, 1) <= 5) OR
    (platform = 'twitter' AND ARRAY_LENGTH(hashtags, 1) <= 2) OR
    (platform = 'instagram' AND ARRAY_LENGTH(hashtags, 1) <= 30) OR
    (platform = 'youtube' AND ARRAY_LENGTH(hashtags, 1) <= 15) OR
    (platform = 'facebook' AND ARRAY_LENGTH(hashtags, 1) <= 30) OR
    hashtags IS NULL
);

-- Media limits
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_media_limits CHECK (
    (platform = 'linkedin' AND ARRAY_LENGTH(media_urls, 1) <= 9) OR
    (platform = 'twitter' AND ARRAY_LENGTH(media_urls, 1) <= 4) OR
    (platform = 'instagram' AND ARRAY_LENGTH(media_urls, 1) <= 10) OR
    (platform = 'youtube' AND ARRAY_LENGTH(media_urls, 1) <= 1) OR
    (platform = 'facebook' AND ARRAY_LENGTH(media_urls, 1) <= 12) OR
    media_urls IS NULL
);

-- Video duration limits
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_video_duration CHECK (
    video_duration IS NULL OR video_duration > 0
);

-- Engagement rate validation
ALTER TABLE content_analytics ADD CONSTRAINT chk_engagement_rate CHECK (
    engagement_rate >= 0 AND engagement_rate <= 100
);

-- Hour validation
ALTER TABLE content_analytics ADD CONSTRAINT chk_hour CHECK (hour >= 0 AND hour <= 23);

-- Day of week validation
ALTER TABLE optimal_posting_times ADD CONSTRAINT chk_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6);

-- Hour validation for optimal times
ALTER TABLE optimal_posting_times ADD CONSTRAINT chk_optimal_hour CHECK (hour >= 0 AND hour <= 23);

-- ==============================================
-- INITIAL DATA SETUP
-- ==============================================

-- Insert platform configurations
INSERT INTO platform_configurations (platform, posting_limits, content_limits, media_limits) VALUES
('linkedin', 
 '{"max_posts_per_day": 5, "max_posts_per_hour": 1, "min_interval_minutes": 60}',
 '{"max_characters": 3000, "max_hashtags": 5, "max_mentions": 10}',
 '{"max_files": 9, "max_file_size_mb": 5120, "allowed_formats": ["jpg", "png", "mp4", "mov", "pdf"], "max_video_duration": 600}'
),
('twitter',
 '{"max_posts_per_day": 50, "max_posts_per_hour": 5, "min_interval_minutes": 12}',
 '{"max_characters": 280, "max_hashtags": 2, "max_mentions": 10}',
 '{"max_files": 4, "max_file_size_mb": 15, "allowed_formats": ["jpg", "png", "gif", "mp4", "mov"], "max_video_duration": 140}'
),
('instagram',
 '{"max_posts_per_day": 25, "max_posts_per_hour": 3, "min_interval_minutes": 20}',
 '{"max_characters": 2200, "max_hashtags": 30, "max_mentions": 20}',
 '{"max_files": 10, "max_file_size_mb": 100, "allowed_formats": ["jpg", "png", "mp4", "mov"], "max_video_duration": 60}'
),
('youtube',
 '{"max_posts_per_day": 10, "max_posts_per_hour": 1, "min_interval_minutes": 60}',
 '{"max_characters": 5000, "max_hashtags": 15, "max_mentions": 0}',
 '{"max_files": 1, "max_file_size_mb": 262144, "allowed_formats": ["mp4", "mov", "avi", "wmv"], "max_video_duration": 43200}'
),
('facebook',
 '{"max_posts_per_day": 25, "max_posts_per_hour": 3, "min_interval_minutes": 20}',
 '{"max_characters": 63206, "max_hashtags": 30, "max_mentions": 50}',
 '{"max_files": 12, "max_file_size_mb": 1024, "allowed_formats": ["jpg", "png", "gif", "mp4", "mov"], "max_video_duration": 1200}'
);

-- Insert system settings
INSERT INTO system_settings (key, value, description) VALUES
('queue_processing_interval', '10000', 'Queue processing interval in milliseconds'),
('max_retry_attempts', '3', 'Maximum number of retry attempts for failed posts'),
('analytics_retention_days', '365', 'Number of days to retain analytics data'),
('notification_retention_days', '30', 'Number of days to retain notifications'),
('ai_analysis_enabled', 'true', 'Whether AI content analysis is enabled'),
('optimal_timing_enabled', 'true', 'Whether optimal posting time suggestions are enabled');

-- ==============================================
-- SUCCESS MESSAGE
-- ==============================================

SELECT 'Comprehensive scheduling system database schema created successfully!' as message;























