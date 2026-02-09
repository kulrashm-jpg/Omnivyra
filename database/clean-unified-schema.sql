-- CLEAN UNIFIED DATABASE SCHEMA FOR SCHEDULING SYSTEM
-- No duplications, optimized for performance and scalability

-- ==============================================
-- CORE TABLES
-- ==============================================

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
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
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    permissions TEXT[], -- Array of granted permissions/scopes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform, platform_user_id)
);

-- Campaigns Table
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    virality_playbook_id UUID REFERENCES virality_playbooks(id) ON DELETE SET NULL,
    start_date DATE,
    end_date DATE,
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'active', 'paused', 'completed'
    budget DECIMAL(10,2),
    goals TEXT[],
    target_audience TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- UNIFIED CONTENT TABLES
-- ==============================================

-- Scheduled Posts Table (main scheduling entity)
CREATE TABLE scheduled_posts (
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
    location VARCHAR(200),
    
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
    
    -- Image Specific
    image_width INTEGER,
    image_height INTEGER,
    image_aspect_ratio VARCHAR(10),
    
    -- Audio Specific (for LinkedIn audio events)
    audio_duration INTEGER,
    audio_title VARCHAR(200),
    audio_url VARCHAR(500),
    
    -- Thread/Series Specific (for Twitter threads, Instagram carousels)
    parent_post_id UUID REFERENCES scheduled_posts(id),
    thread_position INTEGER,
    is_thread_start BOOLEAN DEFAULT FALSE,
    
    -- Stickers/Interactive Elements (for Stories)
    stickers JSONB,
    
    -- Scheduling & Status
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'
    published_at TIMESTAMP WITH TIME ZONE,
    post_url TEXT, -- URL of the published post
    platform_post_id VARCHAR(255), -- ID returned by the social platform
    error_message TEXT,
    
    -- Retry Logic
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- AI Assessment
    ai_score INTEGER, -- AI assessment score for this specific post
    uniqueness_score INTEGER, -- AI score for uniqueness
    repetition_score INTEGER, -- AI score for repetition
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Media Files Table (for file management)
CREATE TABLE media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL, -- 'image/jpeg', 'video/mp4', 'audio/mp3'
    file_size_bytes BIGINT NOT NULL,
    storage_url TEXT NOT NULL, -- URL to the stored media file
    thumbnail_url TEXT, -- Optional thumbnail for videos/documents
    dimensions VARCHAR(50), -- '1920x1080'
    duration_seconds INTEGER, -- For video/audio
    metadata JSONB, -- Additional file metadata
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
-- ANALYTICS TABLES
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

-- ==============================================
-- QUEUE MANAGEMENT TABLES
-- ==============================================

-- Queue Jobs Table (for background processing)
CREATE TABLE queue_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL, -- 'publish', 'retry', 'analytics'
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- INDEXES FOR PERFORMANCE
-- ==============================================

-- Users indexes
CREATE INDEX idx_users_email ON users(email);

-- Social Accounts indexes
CREATE INDEX idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX idx_social_accounts_active ON social_accounts(is_active);

-- Campaigns indexes
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_dates ON campaigns(start_date, end_date);

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

-- Media Files indexes
CREATE INDEX idx_media_files_user_id ON media_files(user_id);
CREATE INDEX idx_media_files_type ON media_files(file_type);

-- Content Analytics indexes
CREATE INDEX idx_content_analytics_post ON content_analytics(scheduled_post_id);
CREATE INDEX idx_content_analytics_platform ON content_analytics(platform, content_type);
CREATE INDEX idx_content_analytics_date ON content_analytics(date);
CREATE INDEX idx_content_analytics_engagement ON content_analytics(engagement_rate);

-- Platform Performance indexes
CREATE INDEX idx_platform_performance_user ON platform_performance(user_id, platform);
CREATE INDEX idx_platform_performance_date ON platform_performance(date);

-- Queue Jobs indexes
CREATE INDEX idx_queue_jobs_scheduled_for ON queue_jobs(scheduled_for);
CREATE INDEX idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX idx_queue_jobs_retry ON queue_jobs(next_retry_at) WHERE status = 'failed';

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
CREATE TRIGGER update_scheduled_posts_updated_at BEFORE UPDATE ON scheduled_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_queue_jobs_updated_at BEFORE UPDATE ON queue_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
