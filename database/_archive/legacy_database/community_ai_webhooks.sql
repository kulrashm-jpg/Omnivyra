CREATE TABLE IF NOT EXISTS community_ai_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT now()
);

-- Guard: PATCH handler updates updated_at
ALTER TABLE community_ai_webhooks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_community_ai_webhooks_tenant_org
  ON community_ai_webhooks(tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_webhooks_event_type
  ON community_ai_webhooks(event_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_webhooks_event_type_check'
  ) THEN
    ALTER TABLE community_ai_webhooks
      ADD CONSTRAINT community_ai_webhooks_event_type_check
      CHECK (event_type IN ('failed', 'high_risk_pending', 'anomaly', 'executed'));
  END IF;
END $$;
