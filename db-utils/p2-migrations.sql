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
    -- Guard: table may not exist yet in some environments
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'weekly_content_refinements'
    ) THEN
        -- Always add columns first (no FK), so migration doesn't fail if users table is missing
        ALTER TABLE weekly_content_refinements
            ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID,
            ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'not_started',
            ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS notes TEXT;

        CREATE INDEX IF NOT EXISTS idx_weekly_refinements_assigned
            ON weekly_content_refinements(assigned_to_user_id);

        -- Add FK constraints only when users table exists
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'users'
        ) THEN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_weekly_refinements_assigned_to_user') THEN
                ALTER TABLE weekly_content_refinements
                    ADD CONSTRAINT fk_weekly_refinements_assigned_to_user
                    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_weekly_refinements_assigned_by_user') THEN
                ALTER TABLE weekly_content_refinements
                    ADD CONSTRAINT fk_weekly_refinements_assigned_by_user
                    FOREIGN KEY (assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;
END $$;

-- ==============================================
-- 4. ADD ERROR_CODE TO SCHEDULED_POSTS (if not exists)
-- ==============================================

DO $$
BEGIN
    -- Guard: table may not exist yet in some environments
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'scheduled_posts'
    ) THEN
        -- Add columns independently (idempotent even when one already exists)
        ALTER TABLE scheduled_posts
            ADD COLUMN IF NOT EXISTS error_code VARCHAR(100),
            ADD COLUMN IF NOT EXISTS error_message TEXT;

        -- Index only depends on error_code existing (which is ensured above)
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

-- ==============================================
-- 7. PLATFORM INTELLIGENCE (DB-DRIVEN CONFIG)
-- ==============================================

-- Master list of platforms with canonical keys (internal)
CREATE TABLE IF NOT EXISTS platform_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    canonical_key TEXT NOT NULL UNIQUE,
    category TEXT,
    supports_auto_publish BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_master_active ON platform_master(active);

-- Content-type capabilities and limits per platform
CREATE TABLE IF NOT EXISTS platform_content_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID NOT NULL REFERENCES platform_master(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    max_characters INTEGER,
    max_words INTEGER,
    media_format TEXT,
    supports_hashtags BOOLEAN DEFAULT FALSE,
    supports_mentions BOOLEAN DEFAULT FALSE,
    supports_links BOOLEAN DEFAULT TRUE,
    formatting_rules JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (platform_id, content_type)
);

CREATE INDEX IF NOT EXISTS idx_platform_content_rules_platform_id ON platform_content_rules(platform_id);

-- Required/optional metadata fields per platform & content type
CREATE TABLE IF NOT EXISTS platform_post_metadata_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID NOT NULL REFERENCES platform_master(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    required_fields JSONB DEFAULT '[]'::jsonb,
    optional_fields JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (platform_id, content_type)
);

CREATE INDEX IF NOT EXISTS idx_platform_post_metadata_platform_id ON platform_post_metadata_requirements(platform_id);

-- Seed initial platforms (idempotent)
INSERT INTO platform_master (name, canonical_key, category, supports_auto_publish, active) VALUES
('LinkedIn', 'linkedin', 'social', TRUE, TRUE),
('Facebook', 'facebook', 'social', TRUE, TRUE),
('Instagram', 'instagram', 'social', TRUE, TRUE),
('YouTube', 'youtube', 'video', TRUE, TRUE),
('X', 'x', 'social', TRUE, TRUE),
('TikTok', 'tiktok', 'social', TRUE, TRUE)
ON CONFLICT (canonical_key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  supports_auto_publish = EXCLUDED.supports_auto_publish,
  active = EXCLUDED.active;

-- Seed content rules (idempotent). formatting_rules can carry extra platform-specific behavior such as type_map.
INSERT INTO platform_content_rules (
  platform_id,
  content_type,
  max_characters,
  max_words,
  media_format,
  supports_hashtags,
  supports_mentions,
  supports_links,
  formatting_rules
) VALUES
-- LinkedIn
((SELECT id FROM platform_master WHERE canonical_key = 'linkedin'), 'post', 3000, 450, 'text', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 5, "suggested_times": ["09:00"], "type_map": {"post":"post","video":"video","article":"article","poll":"post","carousel":"post"}}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'linkedin'), 'article', 125000, 2500, 'text', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 3, "suggested_times": ["09:00"]}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'linkedin'), 'video', 2000, 300, 'video', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 5, "suggested_times": ["18:00"]}'::jsonb),

-- Facebook
((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'post', 63206, 2500, 'text', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 30, "suggested_times": ["09:00"], "type_map": {"post":"post","video":"video","article":"post","poll":"post","carousel":"post"}}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'story', 500, 120, 'image', TRUE, TRUE, FALSE,
  '{"hashtag_limit": 10, "suggested_times": ["12:00"]}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'video', 5000, 500, 'video', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 30, "suggested_times": ["18:00"]}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'reel', 2200, 300, 'video', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 30, "suggested_times": ["19:00"]}'::jsonb),

-- Instagram
((SELECT id FROM platform_master WHERE canonical_key = 'instagram'), 'feed_post', 2200, 300, 'image', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 30, "suggested_times": ["19:00"], "type_map": {"post":"feed_post","video":"reel","article":"feed_post","poll":"feed_post","carousel":"feed_post"}}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'instagram'), 'story', 2200, 120, 'image', TRUE, TRUE, FALSE,
  '{"hashtag_limit": 10, "suggested_times": ["11:00"]}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'instagram'), 'reel', 2200, 300, 'video', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 30, "suggested_times": ["19:00"]}'::jsonb),

-- YouTube
((SELECT id FROM platform_master WHERE canonical_key = 'youtube'), 'video', 5000, 1200, 'video', TRUE, FALSE, TRUE,
  '{"hashtag_limit": 15, "suggested_times": ["18:00"], "type_map": {"post":"video","video":"video","article":"video","poll":"video","carousel":"short"}}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'youtube'), 'short', 100, 120, 'video', TRUE, FALSE, TRUE,
  '{"hashtag_limit": 15, "suggested_times": ["18:00"]}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'youtube'), 'live', 5000, 2500, 'video', TRUE, FALSE, TRUE,
  '{"hashtag_limit": 15, "suggested_times": ["18:00"]}'::jsonb),

-- X (Twitter)
((SELECT id FROM platform_master WHERE canonical_key = 'x'), 'tweet', 280, 80, 'text', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 2, "suggested_times": ["12:00"], "type_map": {"post":"tweet","video":"video","article":"tweet","poll":"tweet","carousel":"tweet"}}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'x'), 'thread', 280, 120, 'text', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 1, "suggested_times": ["12:00"]}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'x'), 'video', 280, 80, 'video', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 2, "suggested_times": ["12:00"]}'::jsonb),

-- TikTok
((SELECT id FROM platform_master WHERE canonical_key = 'tiktok'), 'video', 2200, 300, 'video', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 10, "suggested_times": ["20:00"], "type_map": {"post":"video","video":"video","article":"video","poll":"video","carousel":"video"}}'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'tiktok'), 'live', 2200, 300, 'video', TRUE, TRUE, TRUE,
  '{"hashtag_limit": 10, "suggested_times": ["20:00"]}'::jsonb)
ON CONFLICT (platform_id, content_type) DO UPDATE SET
  max_characters = EXCLUDED.max_characters,
  max_words = EXCLUDED.max_words,
  media_format = EXCLUDED.media_format,
  supports_hashtags = EXCLUDED.supports_hashtags,
  supports_mentions = EXCLUDED.supports_mentions,
  supports_links = EXCLUDED.supports_links,
  formatting_rules = EXCLUDED.formatting_rules;

-- Seed posting requirements (idempotent)
INSERT INTO platform_post_metadata_requirements (
  platform_id,
  content_type,
  required_fields,
  optional_fields
) VALUES
((SELECT id FROM platform_master WHERE canonical_key = 'linkedin'), 'post', '["cta"]'::jsonb, '["hashtags","mentions","links","best_time"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'linkedin'), 'article', '["seo_title","seo_description"]'::jsonb, '["cta","hashtags","links"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'linkedin'), 'video', '["cta"]'::jsonb, '["hashtags","mentions","links"]'::jsonb),

((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'post', '[]'::jsonb, '["hashtags","mentions","links","cta"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'story', '[]'::jsonb, '["hashtags","mentions"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'video', '[]'::jsonb, '["hashtags","mentions","links","cta"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'facebook'), 'reel', '[]'::jsonb, '["hashtags","mentions","links","cta"]'::jsonb),

((SELECT id FROM platform_master WHERE canonical_key = 'instagram'), 'feed_post', '["hashtags"]'::jsonb, '["mentions","links","cta"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'instagram'), 'story', '[]'::jsonb, '["hashtags","mentions"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'instagram'), 'reel', '["hashtags"]'::jsonb, '["mentions","links","cta"]'::jsonb),

((SELECT id FROM platform_master WHERE canonical_key = 'youtube'), 'video', '["cta"]'::jsonb, '["hashtags","links"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'youtube'), 'short', '[]'::jsonb, '["hashtags","links"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'youtube'), 'live', '[]'::jsonb, '["hashtags","links"]'::jsonb),

((SELECT id FROM platform_master WHERE canonical_key = 'x'), 'tweet', '[]'::jsonb, '["hashtags","mentions","links"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'x'), 'thread', '[]'::jsonb, '["hashtags","mentions","links"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'x'), 'video', '[]'::jsonb, '["hashtags","mentions","links"]'::jsonb),

((SELECT id FROM platform_master WHERE canonical_key = 'tiktok'), 'video', '["hashtags"]'::jsonb, '["mentions","links"]'::jsonb),
((SELECT id FROM platform_master WHERE canonical_key = 'tiktok'), 'live', '[]'::jsonb, '["hashtags","mentions","links"]'::jsonb)
ON CONFLICT (platform_id, content_type) DO UPDATE SET
  required_fields = EXCLUDED.required_fields,
  optional_fields = EXCLUDED.optional_fields;

-- ==============================================
-- 8. DYNAMIC PLATFORM/CONTENT VALIDATION (TRIGGER)
-- ==============================================

-- Remove legacy hardcoded constraints (if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'scheduled_posts'
  ) THEN
    ALTER TABLE scheduled_posts DROP CONSTRAINT IF EXISTS chk_platform;
    ALTER TABLE scheduled_posts DROP CONSTRAINT IF EXISTS chk_content_type;
  END IF;
END $$;

-- Trigger-based validation backed by platform intelligence tables.
-- Reject only when platform/content_type are not present in platform_master/platform_content_rules.
CREATE OR REPLACE FUNCTION validate_scheduled_posts_platform_content()
RETURNS TRIGGER AS $$
DECLARE
  input_platform text;
  canonical_platform_key text;
  normalized_content_type text;
  platform_id uuid;
BEGIN
  input_platform := lower(trim(coalesce(NEW.platform, '')));
  normalized_content_type := lower(trim(coalesce(NEW.content_type, '')));

  IF input_platform = '' THEN
    RAISE EXCEPTION 'platform is required' USING ERRCODE = '23514';
  END IF;
  IF normalized_content_type = '' THEN
    RAISE EXCEPTION 'content_type is required' USING ERRCODE = '23514';
  END IF;

  -- Legacy compatibility: scheduled_posts.platform historically stores 'twitter'
  -- while platform intelligence uses canonical_key 'x'.
  canonical_platform_key := input_platform;
  IF canonical_platform_key = 'twitter' THEN
    canonical_platform_key := 'x';
  END IF;

  SELECT pm.id
    INTO platform_id
  FROM platform_master pm
  WHERE lower(pm.canonical_key) = canonical_platform_key
  LIMIT 1;

  IF platform_id IS NULL THEN
    RAISE EXCEPTION 'Invalid platform "%"', input_platform USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_content_rules pcr
    WHERE pcr.platform_id = platform_id
      AND lower(pcr.content_type) = normalized_content_type
  ) THEN
    RAISE EXCEPTION 'Invalid content_type "%" for platform "%"', normalized_content_type, canonical_platform_key
      USING ERRCODE = '23514';
  END IF;

  -- Normalize stored content_type; do NOT rewrite platform (preserves legacy 'twitter' storage).
  NEW.content_type := normalized_content_type;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotent trigger install
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'scheduled_posts'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'platform_master'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'platform_content_rules'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_validate_scheduled_posts_platform_content ON scheduled_posts';
    EXECUTE 'CREATE TRIGGER trg_validate_scheduled_posts_platform_content
      BEFORE INSERT OR UPDATE OF platform, content_type ON scheduled_posts
      FOR EACH ROW EXECUTE FUNCTION validate_scheduled_posts_platform_content()';
  END IF;
END $$;

