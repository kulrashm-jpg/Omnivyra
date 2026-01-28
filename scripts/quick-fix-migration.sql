-- =====================================================
-- QUICK FIX MIGRATION - Add Missing Columns/Tables
-- =====================================================
-- Run this in Supabase SQL Editor to fix test failures
-- This adds only the missing items identified by tests
-- =====================================================

BEGIN;

-- 1. Add priority column to scheduled_posts (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'scheduled_posts' 
        AND column_name = 'priority'
    ) THEN
        ALTER TABLE scheduled_posts ADD COLUMN priority INTEGER DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_priority ON scheduled_posts(priority);
        RAISE NOTICE 'Added priority column to scheduled_posts';
    ELSE
        RAISE NOTICE 'priority column already exists';
    END IF;
END $$;

-- 2. Add error_code and error_message to scheduled_posts (if missing)
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
        RAISE NOTICE 'Added error_code and error_message columns';
    ELSE
        RAISE NOTICE 'error_code columns already exist';
    END IF;
END $$;

-- 3. Create activity_feed table (if missing)
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

CREATE INDEX IF NOT EXISTS idx_activity_feed_user_id ON activity_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_campaign_id ON activity_feed(campaign_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_created_at ON activity_feed(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_feed_action_type ON activity_feed(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_feed_user_created ON activity_feed(user_id, created_at DESC);

-- 4. Add focus_areas and week_start_date to weekly_content_refinements (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'weekly_content_refinements' 
        AND column_name = 'focus_areas'
    ) THEN
        ALTER TABLE weekly_content_refinements 
        ADD COLUMN focus_areas TEXT[],
        ADD COLUMN week_start_date DATE;
        RAISE NOTICE 'Added focus_areas and week_start_date columns';
    ELSE
        RAISE NOTICE 'focus_areas columns already exist';
    END IF;
END $$;

-- 5. Add retweets, quotes, reactions to content_analytics (if missing)
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
        RAISE NOTICE 'Added retweets, quotes, reactions columns';
    ELSE
        RAISE NOTICE 'Platform metric columns already exist';
    END IF;
END $$;

-- 6. Add priority to queue_jobs (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'queue_jobs' 
        AND column_name = 'priority'
    ) THEN
        ALTER TABLE queue_jobs ADD COLUMN priority INTEGER DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_priority ON queue_jobs(priority);
        RAISE NOTICE 'Added priority column to queue_jobs';
    ELSE
        RAISE NOTICE 'queue_jobs.priority already exists';
    END IF;
END $$;

COMMIT;

-- Verification queries (run after migration)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'scheduled_posts' AND column_name = 'priority';
-- SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'activity_feed';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'weekly_content_refinements' AND column_name = 'focus_areas';

