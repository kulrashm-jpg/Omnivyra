-- ADDITIONAL SOCIAL MEDIA MANAGEMENT TABLES
-- This script adds remaining social media management and system tables
-- Run this AFTER critical-missing-tables.sql

-- ==============================================
-- 1. MEDIA MANAGEMENT TABLES
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
-- 2. BACKGROUND PROCESSING TABLES
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
-- 3. RECURRING POSTS TABLE
-- ==============================================

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
-- 4. SYSTEM FEATURES TABLES
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
-- 5. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Media Files indexes
CREATE INDEX IF NOT EXISTS idx_media_files_user_id ON media_files(user_id);
CREATE INDEX IF NOT EXISTS idx_media_files_campaign_id ON media_files(campaign_id);
CREATE INDEX IF NOT EXISTS idx_media_files_media_type ON media_files(media_type);

-- Scheduled Post Media indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_post_media_post_id ON scheduled_post_media(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_post_media_file_id ON scheduled_post_media(media_file_id);

-- Queue Jobs indexes
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled_for ON queue_jobs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_priority ON queue_jobs(priority);

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

-- ==============================================
-- 6. SUCCESS MESSAGE
-- ==============================================

SELECT 'Additional social media management tables added successfully!' as message;


