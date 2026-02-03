CREATE TABLE IF NOT EXISTS community_ai_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  action_id UUID,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_ai_notifications_tenant_org
  ON community_ai_notifications(tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_notifications_event_type
  ON community_ai_notifications(event_type);

CREATE INDEX IF NOT EXISTS idx_community_ai_notifications_is_read
  ON community_ai_notifications(is_read);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_notifications_event_type_check'
  ) THEN
    ALTER TABLE community_ai_notifications
      ADD CONSTRAINT community_ai_notifications_event_type_check
      CHECK (event_type IN ('approved', 'executed', 'failed', 'high_risk_pending'));
  END IF;
END $$;
