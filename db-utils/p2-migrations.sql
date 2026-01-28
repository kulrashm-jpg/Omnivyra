-- ==============================================
-- P2 PHASE - DATABASE MIGRATIONS
-- ==============================================
-- Run this after P0/P1 migrations are complete

-- ==============================================
-- 1. ACTIVITY FEED TABLE
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

CREATE INDEX IF NOT EXISTS idx_activity_feed_user_id ON activity_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_campaign_id ON activity_feed(campaign_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_created_at ON activity_feed(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_feed_action_type ON activity_feed(action_type);

-- ==============================================
-- 2. ADD PRIORITY TO SCHEDULED_POSTS
-- ==============================================

-- Add priority column if it doesn't exist
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

-- ==============================================
-- 3. ADD ASSIGNMENT COLUMNS TO WEEKLY_REFINEMENTS
-- ==============================================

-- Add assignment columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'weekly_content_refinements' 
        AND column_name = 'assigned_to_user_id'
    ) THEN
        ALTER TABLE weekly_content_refinements 
        ADD COLUMN assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN status VARCHAR(50) DEFAULT 'not_started',
        ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN notes TEXT;
        
        CREATE INDEX IF NOT EXISTS idx_weekly_refinements_assigned ON weekly_content_refinements(assigned_to_user_id);
    END IF;
END $$;

-- ==============================================
-- 4. ADD ERROR_CODE TO SCHEDULED_POSTS (if not exists)
-- ==============================================

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

-- ==============================================
-- 5. CREATE FUNCTION FOR INCREMENTING TEMPLATE USAGE
-- ==============================================

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
-- 6. INDEXES FOR PERFORMANCE
-- ==============================================

-- Index for scheduler queries (status, priority, scheduled_for)
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_priority_scheduled 
ON scheduled_posts(status, priority DESC, scheduled_for) 
WHERE status = 'scheduled';

-- Index for conflict detection
CREATE INDEX IF NOT EXISTS idx_campaigns_user_dates 
ON campaigns(user_id, start_date, end_date) 
WHERE status NOT IN ('completed', 'cancelled');

COMMENT ON TABLE activity_feed IS 'Audit log and activity feed for all user actions';
COMMENT ON COLUMN scheduled_posts.priority IS 'Post priority: 0 = normal, >0 = high priority (processed first)';
COMMENT ON COLUMN weekly_content_refinements.assigned_to_user_id IS 'Team member assigned to work on this week';
COMMENT ON COLUMN scheduled_posts.error_code IS 'Categorized error code for analytics and recovery';

