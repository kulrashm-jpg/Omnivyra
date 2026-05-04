-- STEP 6: CREATE SYSTEM TABLES AND INDEXES
-- Run this after step 5 is complete

-- Platform Configurations Table
CREATE TABLE platform_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL UNIQUE,
    is_enabled BOOLEAN DEFAULT TRUE,
    posting_limits JSONB NOT NULL,
    content_limits JSONB NOT NULL,
    media_limits JSONB NOT NULL,
    api_configuration JSONB,
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

-- Create Indexes for Performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_subscription ON users(subscription_plan, subscription_status);

CREATE INDEX idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX idx_social_accounts_active ON social_accounts(is_active);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);

CREATE INDEX idx_content_templates_user_id ON content_templates(user_id);
CREATE INDEX idx_content_templates_platform ON content_templates(platform);

CREATE INDEX idx_scheduled_posts_user_id ON scheduled_posts(user_id);
CREATE INDEX idx_scheduled_posts_social_account ON scheduled_posts(social_account_id);
CREATE INDEX idx_scheduled_posts_platform ON scheduled_posts(platform);
CREATE INDEX idx_scheduled_posts_scheduled_for ON scheduled_posts(scheduled_for);
CREATE INDEX idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX idx_scheduled_posts_published_at ON scheduled_posts(published_at);

CREATE INDEX idx_media_files_user_id ON media_files(user_id);
CREATE INDEX idx_media_files_type ON media_files(file_type);

CREATE INDEX idx_queue_jobs_scheduled_for ON queue_jobs(scheduled_for);
CREATE INDEX idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX idx_queue_jobs_priority ON queue_jobs(priority DESC, scheduled_for);

CREATE INDEX idx_content_analytics_post ON content_analytics(scheduled_post_id);
CREATE INDEX idx_content_analytics_platform ON content_analytics(platform, content_type);
CREATE INDEX idx_content_analytics_date ON content_analytics(date);

CREATE INDEX idx_platform_performance_user ON platform_performance(user_id, platform);
CREATE INDEX idx_hashtag_performance_user ON hashtag_performance(user_id, platform);
CREATE INDEX idx_ai_analysis_post ON ai_content_analysis(scheduled_post_id);
CREATE INDEX idx_optimal_times_user ON optimal_posting_times(user_id, platform);
CREATE INDEX idx_notifications_user ON notifications(user_id);

-- Success message
SELECT 'System tables and indexes created successfully! Now run step 7.' as message;
