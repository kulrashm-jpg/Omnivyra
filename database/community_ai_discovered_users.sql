CREATE TABLE IF NOT EXISTS community_ai_discovered_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  external_user_id TEXT,
  external_username TEXT,
  profile_url TEXT NOT NULL,
  discovered_via TEXT NOT NULL,
  discovery_source TEXT,
  source_url TEXT,
  classification TEXT,
  confidence_score NUMERIC,
  eligible_for_engagement BOOLEAN DEFAULT TRUE,
  blocked_reason TEXT,
  first_seen_at TIMESTAMP DEFAULT now(),
  last_seen_at TIMESTAMP DEFAULT now(),
  metadata JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_users_unique
  ON community_ai_discovered_users(tenant_id, organization_id, platform, profile_url);

CREATE INDEX IF NOT EXISTS idx_discovered_users_tenant_org
  ON community_ai_discovered_users(tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_discovered_users_platform
  ON community_ai_discovered_users(platform);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_discovered_users_discovered_via_check'
  ) THEN
    ALTER TABLE community_ai_discovered_users
      ADD CONSTRAINT community_ai_discovered_users_discovered_via_check
      CHECK (discovered_via IN ('api', 'rpa'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_discovered_users_classification_check'
  ) THEN
    ALTER TABLE community_ai_discovered_users
      ADD CONSTRAINT community_ai_discovered_users_classification_check
      CHECK (classification IS NULL OR classification IN (
        'influencer',
        'peer',
        'prospect',
        'spam_risk',
        'unknown'
      ));
  END IF;
END $$;
