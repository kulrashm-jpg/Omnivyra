CREATE TABLE IF NOT EXISTS community_ai_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_ai_action_logs_action
  ON community_ai_action_logs(action_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_action_logs_tenant_org
  ON community_ai_action_logs(tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_action_logs_event_type
  ON community_ai_action_logs(event_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_action_logs_event_type_check'
  ) THEN
    ALTER TABLE community_ai_action_logs
      ADD CONSTRAINT community_ai_action_logs_event_type_check
      CHECK (event_type IN ('approved', 'executed', 'failed', 'skipped', 'scheduled'));
  END IF;
END $$;
