-- STEP 7: CREATE TRIGGERS AND CONSTRAINTS
-- Run this after step 6 is complete

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

-- Add Platform Constraints
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_platform CHECK (platform IN ('linkedin', 'twitter', 'instagram', 'youtube', 'facebook'));

-- Add Content Type Constraints
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_content_type CHECK (
    (platform = 'linkedin' AND content_type IN ('post', 'article', 'video', 'audio_event')) OR
    (platform = 'twitter' AND content_type IN ('tweet', 'thread', 'video')) OR
    (platform = 'instagram' AND content_type IN ('feed_post', 'story', 'reel', 'igtv')) OR
    (platform = 'youtube' AND content_type IN ('video', 'short', 'live')) OR
    (platform = 'facebook' AND content_type IN ('post', 'story', 'video', 'event'))
);

-- Add Status Constraints
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_status CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'));

-- Add Character Limit Constraints
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_linkedin_content CHECK (platform != 'linkedin' OR LENGTH(content) <= 3000);
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_twitter_content CHECK (platform != 'twitter' OR LENGTH(content) <= 280);
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_instagram_content CHECK (platform != 'instagram' OR LENGTH(content) <= 2200);
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_youtube_content CHECK (platform != 'youtube' OR LENGTH(content) <= 5000);
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_facebook_content CHECK (platform != 'facebook' OR LENGTH(content) <= 63206);

-- Add Hashtag Limit Constraints
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_hashtag_limits CHECK (
    (platform = 'linkedin' AND ARRAY_LENGTH(hashtags, 1) <= 5) OR
    (platform = 'twitter' AND ARRAY_LENGTH(hashtags, 1) <= 2) OR
    (platform = 'instagram' AND ARRAY_LENGTH(hashtags, 1) <= 30) OR
    (platform = 'youtube' AND ARRAY_LENGTH(hashtags, 1) <= 15) OR
    (platform = 'facebook' AND ARRAY_LENGTH(hashtags, 1) <= 30) OR
    hashtags IS NULL
);

-- Add Media Limit Constraints
ALTER TABLE scheduled_posts ADD CONSTRAINT chk_media_limits CHECK (
    (platform = 'linkedin' AND ARRAY_LENGTH(media_urls, 1) <= 9) OR
    (platform = 'twitter' AND ARRAY_LENGTH(media_urls, 1) <= 4) OR
    (platform = 'instagram' AND ARRAY_LENGTH(media_urls, 1) <= 10) OR
    (platform = 'youtube' AND ARRAY_LENGTH(media_urls, 1) <= 1) OR
    (platform = 'facebook' AND ARRAY_LENGTH(media_urls, 1) <= 12) OR
    media_urls IS NULL
);

-- Add Analytics Constraints
ALTER TABLE content_analytics ADD CONSTRAINT chk_engagement_rate CHECK (engagement_rate >= 0 AND engagement_rate <= 100);
ALTER TABLE content_analytics ADD CONSTRAINT chk_hour CHECK (hour >= 0 AND hour <= 23);
ALTER TABLE optimal_posting_times ADD CONSTRAINT chk_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6);
ALTER TABLE optimal_posting_times ADD CONSTRAINT chk_optimal_hour CHECK (hour >= 0 AND hour <= 23);

-- Success message
SELECT 'Triggers and constraints created successfully! Now run step 8.' as message;
