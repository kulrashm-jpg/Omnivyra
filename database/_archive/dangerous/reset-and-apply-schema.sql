-- DROP EXISTING TABLES AND APPLY CLEAN SCHEMA
-- This script will clean up any existing tables and apply the unified schema

-- ==============================================
-- DROP EXISTING TABLES (in reverse dependency order)
-- ==============================================

-- Drop analytics tables first
DROP TABLE IF EXISTS content_analytics CASCADE;
DROP TABLE IF EXISTS platform_performance CASCADE;

-- Drop queue tables
DROP TABLE IF EXISTS queue_jobs CASCADE;

-- Drop junction tables
DROP TABLE IF EXISTS scheduled_post_media CASCADE;

-- Drop main content tables
DROP TABLE IF EXISTS scheduled_posts CASCADE;
DROP TABLE IF EXISTS media_files CASCADE;

-- Drop campaign tables
DROP TABLE IF EXISTS campaign_content CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;

-- Drop platform-specific tables (if they exist)
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

-- Drop social accounts and users
DROP TABLE IF EXISTS social_accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop any other tables that might exist
DROP TABLE IF EXISTS connected_accounts CASCADE;
DROP TABLE IF EXISTS post_events CASCADE;

-- ==============================================
-- DROP FUNCTIONS AND TRIGGERS
-- ==============================================

DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- ==============================================
-- APPLY CLEAN UNIFIED SCHEMA
-- ==============================================

-- Now run the clean-unified-schema.sql file
-- This will create all the new unified tables with proper relationships























