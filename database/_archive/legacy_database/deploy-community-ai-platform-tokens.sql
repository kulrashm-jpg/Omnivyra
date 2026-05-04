-- Community AI Platform Tokens: Full deployment (table + G2.4 column)
-- Run this before patch-community-ai-platform-tokens-connected-by-user.sql
-- If table already exists, run patch-community-ai-platform-tokens-connected-by-user.sql only.

-- 1. Create table if not exists (base schema)
CREATE TABLE IF NOT EXISTS community_ai_platform_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 2. Add G2.4 column (idempotent — safe if column already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'community_ai_platform_tokens'
    AND column_name = 'connected_by_user_id'
  ) THEN
    ALTER TABLE community_ai_platform_tokens
      ADD COLUMN connected_by_user_id UUID;
  END IF;
END $$;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_tenant_id
  ON community_ai_platform_tokens(tenant_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_organization_id
  ON community_ai_platform_tokens(organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_platform
  ON community_ai_platform_tokens(platform);

CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_connected_by
  ON community_ai_platform_tokens(connected_by_user_id)
  WHERE connected_by_user_id IS NOT NULL;

-- 4. Comment
COMMENT ON COLUMN community_ai_platform_tokens.connected_by_user_id IS
  'User who connected this platform (G2.4). Owner or Company Admin may disconnect.';
