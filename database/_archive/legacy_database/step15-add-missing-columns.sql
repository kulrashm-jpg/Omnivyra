-- STEP 15: ADD MISSING COLUMNS TO EXISTING TABLES
-- Run this after step 14 is complete

-- Add missing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user'; -- 'admin', 'user', 'viewer', 'moderator'
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_rate_limit INTEGER DEFAULT 1000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_quota_mb INTEGER DEFAULT 1024; -- 1GB default
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used_mb INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}';

-- Add missing columns to social_accounts table
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_type VARCHAR(50) DEFAULT 'personal'; -- 'personal', 'business', 'creator'
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'unverified'; -- 'verified', 'unverified', 'pending'
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_metrics JSONB DEFAULT '{}'; -- Follower count, engagement rate, etc.
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS rate_limit_remaining INTEGER;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS rate_limit_reset_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS following_count INTEGER DEFAULT 0;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE;

-- Add missing columns to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget_total DECIMAL(10,2);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget_spent DECIMAL(10,2) DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_metrics JSONB DEFAULT '{}'; -- KPIs and goals
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approver_id UUID REFERENCES users(id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brand_voice TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_themes TEXT[];
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hashtag_strategy TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS posting_schedule JSONB DEFAULT '{}';

-- Add missing columns to scheduled_posts table
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0; -- For queue prioritization
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS tags TEXT[]; -- User-defined tags
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS target_audience JSONB DEFAULT '{}'; -- Audience targeting
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS budget DECIMAL(10,2); -- For paid promotions
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS promotion_type VARCHAR(50) DEFAULT 'organic'; -- 'organic', 'boosted', 'ad'
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS cross_platform_share BOOLEAN DEFAULT FALSE;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS engagement_goals JSONB DEFAULT '{}'; -- Target likes, shares, etc.
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS alt_text TEXT; -- Accessibility for images
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS mentions TEXT[]; -- @mentions
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS location VARCHAR(200); -- Location tagging
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS video_thumbnail_url TEXT; -- Custom video thumbnail
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS audio_artist VARCHAR(200); -- For audio content
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS thread_title VARCHAR(500); -- For thread content
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS interactive_elements JSONB DEFAULT '{}'; -- For Stories, Reels
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS engagement_prediction INTEGER; -- AI prediction
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS error_code VARCHAR(100); -- Error classification

-- Add missing columns to content_templates table
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS media_requirements JSONB DEFAULT '{}';
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS variables JSONB DEFAULT '{}';
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

-- Add missing columns to recurring_posts table
ALTER TABLE recurring_posts ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE recurring_posts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE recurring_posts ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE recurring_posts ADD COLUMN IF NOT EXISTS next_generation_at TIMESTAMP WITH TIME ZONE;

-- Add missing columns to media_files table
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS original_name VARCHAR(255);
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Add missing columns to queue_jobs table
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS error_code VARCHAR(100);
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS recurring_post_id UUID REFERENCES recurring_posts(id) ON DELETE CASCADE;

-- Add missing columns to content_analytics table
ALTER TABLE content_analytics ADD COLUMN IF NOT EXISTS click_through_rate DECIMAL(5,2) DEFAULT 0.00;

-- Add missing columns to platform_performance table
ALTER TABLE platform_performance ADD COLUMN IF NOT EXISTS best_post_id UUID REFERENCES scheduled_posts(id);
ALTER TABLE platform_performance ADD COLUMN IF NOT EXISTS best_post_engagement DECIMAL(5,2) DEFAULT 0.00;

-- Add missing columns to hashtag_performance table
ALTER TABLE hashtag_performance ADD COLUMN IF NOT EXISTS reach INTEGER DEFAULT 0;

-- Add missing columns to ai_content_analysis table
ALTER TABLE ai_content_analysis ADD COLUMN IF NOT EXISTS suggestions TEXT[];

-- Add missing columns to optimal_posting_times table
ALTER TABLE optimal_posting_times ADD COLUMN IF NOT EXISTS sample_size INTEGER DEFAULT 0;

-- Add missing columns to notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}';

-- Add missing columns to platform_configurations table
ALTER TABLE platform_configurations ADD COLUMN IF NOT EXISTS api_configuration JSONB;

-- Add missing columns to system_settings table
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS description TEXT;

-- Add soft delete support to main tables
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE recurring_posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Success message
SELECT 'Missing columns added to existing tables successfully! Now run step 16.' as message;
