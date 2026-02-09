CREATE TABLE IF NOT EXISTS community_ai_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  suggested_text TEXT,
  tone TEXT,
  tone_used TEXT,
  final_text TEXT,
  risk_level TEXT,
  requires_human_approval BOOLEAN DEFAULT TRUE,
  requires_approval BOOLEAN,
  execution_mode TEXT,
  playbook_id UUID,
  discovered_user_id UUID,
  playbook_name TEXT,
  intent_classification JSONB,
  status TEXT,
  execution_result JSONB,
  scheduled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_tenant_org
  ON community_ai_actions(tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_platform
  ON community_ai_actions(platform);

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_status
  ON community_ai_actions(status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_actions_status_check'
  ) THEN
    ALTER TABLE community_ai_actions
      ADD CONSTRAINT community_ai_actions_status_check
      CHECK (status IN ('pending', 'approved', 'executed', 'failed', 'skipped'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_actions_action_type_check'
  ) THEN
    ALTER TABLE community_ai_actions
      ADD CONSTRAINT community_ai_actions_action_type_check
      CHECK (action_type IN ('like', 'reply', 'share', 'follow', 'schedule'));
  END IF;
END $$;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS tone_used TEXT;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS final_text TEXT;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS execution_mode TEXT;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS playbook_id UUID;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS discovered_user_id UUID;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS playbook_name TEXT;

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS intent_classification JSONB;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_discovered_user
  ON community_ai_actions(tenant_id, organization_id, discovered_user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_actions_discovered_user_fk'
  ) THEN
    ALTER TABLE community_ai_actions
      ADD CONSTRAINT community_ai_actions_discovered_user_fk
      FOREIGN KEY (discovered_user_id)
      REFERENCES community_ai_discovered_users(id)
      ON DELETE SET NULL;
  END IF;
END $$;
