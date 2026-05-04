-- STEP 1: DROP ALL EXISTING TABLES FIRST
-- Run this script first to clean up existing tables

-- Drop analytics tables first (they reference other tables)
DROP TABLE IF EXISTS content_analytics CASCADE;
DROP TABLE IF EXISTS platform_performance CASCADE;
DROP TABLE IF EXISTS hashtag_performance CASCADE;

-- Drop AI and optimization tables
DROP TABLE IF EXISTS ai_content_analysis CASCADE;
DROP TABLE IF EXISTS optimal_posting_times CASCADE;

-- Drop notifications
DROP TABLE IF EXISTS notifications CASCADE;

-- Drop queue tables
DROP TABLE IF EXISTS queue_job_logs CASCADE;
DROP TABLE IF EXISTS queue_jobs CASCADE;

-- Drop junction tables
DROP TABLE IF EXISTS scheduled_post_media CASCADE;

-- Drop main content tables
DROP TABLE IF EXISTS scheduled_posts CASCADE;
DROP TABLE IF EXISTS recurring_posts CASCADE;
DROP TABLE IF EXISTS media_files CASCADE;

-- Drop campaign and template tables
DROP TABLE IF EXISTS content_templates CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;

-- Drop social accounts and users
DROP TABLE IF EXISTS social_accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop system tables
DROP TABLE IF EXISTS platform_configurations CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;

-- Drop any old platform-specific tables that might exist
DROP TABLE IF EXISTS linkedin_posts CASCADE;
DROP TABLE IF EXISTS linkedin_articles CASCADE;
DROP TABLE IF EXISTS linkedin_videos CASCADE;
DROP TABLE IF EXISTS linkedin_audio_events CASCADE;
DROP TABLE IF EXISTS twitter_tweets CASCADE;
DROP TABLE IF EXISTS twitter_threads CASCADE;
DROP TABLE IF EXISTS twitter_videos CASCADE;
DROP TABLE IF EXISTS instagram_feed_posts CASCADE;
DROP TABLE IF EXISTS instagram_stories CASCADE;
DROP TABLE IF EXISTS instagram_reels CASCADE;
DROP TABLE IF EXISTS instagram_igtv CASCADE;
DROP TABLE IF EXISTS youtube_shorts CASCADE;
DROP TABLE IF EXISTS youtube_videos CASCADE;
DROP TABLE IF EXISTS youtube_live CASCADE;
DROP TABLE IF EXISTS facebook_posts CASCADE;
DROP TABLE IF EXISTS facebook_stories CASCADE;
DROP TABLE IF EXISTS facebook_videos CASCADE;
DROP TABLE IF EXISTS facebook_events CASCADE;

-- Drop any other tables that might exist
DROP TABLE IF EXISTS connected_accounts CASCADE;
DROP TABLE IF EXISTS post_events CASCADE;

-- Drop functions and triggers
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Success message
SELECT 'All existing tables dropped successfully! Now run the main schema script.' as message;
